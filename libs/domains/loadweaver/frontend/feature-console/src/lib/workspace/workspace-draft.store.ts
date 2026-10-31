import { HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import {
  ConsoleSocketService,
  DraftsService,
  type Draft,
  type DraftConflict,
  type DraftOpInput,
  type DraftPatchEvent,
  type DraftPatchRequest,
  type DraftPreview,
  type DraftsSnapshotEvent,
  type Plan,
  type ResourceKey,
} from '@forepath/loadweaver/frontend/data-access-console';
import { firstValueFrom } from 'rxjs';
import type { Socket } from 'socket.io-client';

import { draftOpKey } from './workspace-draft';

/** Readable message of an API error (Nest's `message`, strings or lists). */
export function apiErrorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const message = (error.error as { message?: unknown } | null)?.message;

    if (Array.isArray(message)) return message.join('; ');

    if (typeof message === 'string') return message;

    return error.message;
  }

  return error instanceof Error ? error.message : String(error);
}

/**
 * The Workspace's draft (3.36): the open drafts the user may edit (live through `socket/plans`), the active one, its
 * edits under optimistic concurrency (a 409 reloads the current version and says so), the dry-run preview, conflicts,
 * submit (→ plan) and discard. Provided per Workspace page.
 */
@Injectable()
export class WorkspaceDraftStore {
  private readonly api = inject(DraftsService);
  private readonly sockets = inject(ConsoleSocketService);
  private socket: Socket | null = null;

  readonly drafts = signal<Draft[]>([]);
  readonly active = signal<Draft | null>(null);
  readonly preview = signal<DraftPreview | null>(null);
  readonly conflicts = signal<DraftConflict[]>([]);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  /** Why the open drafts couldn't be loaded (Activity › Drafts shows it; `error` is the tray's last action). */
  readonly loadError = signal<string | null>(null);
  /** Someone else changed the active draft (shown once, then cleared). */
  readonly changedByOthers = signal(false);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.disconnect());
  }

  /** Loads the open drafts and follows them live. */
  async connect(): Promise<void> {
    const drafts = await this.call(() => firstValueFrom(this.api.list()), null);

    this.loadError.set(drafts ? null : this.error());
    this.drafts.set(drafts ?? []);

    const socket = await this.sockets.open('plans').catch(() => null);

    if (!socket) return;

    this.socket = socket;
    socket.on('draftsSnapshot', (event: DraftsSnapshotEvent) => this.drafts.set(event?.drafts ?? []));
    socket.on('draftPatch', (event: DraftPatchEvent) => event?.draft && this.patched(event.draft));
  }

  disconnect(): void {
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = null;
  }

  /** A draft changed on the server (socket): list + active draft follow, newer versions only. */
  patched(draft: Draft): void {
    const open = draft.status === 'open';

    this.drafts.update((list) =>
      open ? [draft, ...list.filter((d) => d.id !== draft.id)] : list.filter((d) => d.id !== draft.id),
    );

    const active = this.active();

    if (active?.id === draft.id && draft.version > active.version) {
      this.active.set(open ? draft : null);
      this.preview.set(null);
      this.changedByOthers.set(true);
    }
  }

  async open(id: string | null): Promise<void> {
    this.preview.set(null);
    this.conflicts.set([]);

    if (!id) {
      this.active.set(null);

      return;
    }

    const draft = await this.call(() => firstValueFrom(this.api.get(id)), null);

    this.active.set(draft?.status === 'open' ? draft : null);
  }

  async create(title: string): Promise<Draft | null> {
    const draft = await this.call(() => firstValueFrom(this.api.create(title)), null);

    if (draft) {
      this.active.set(draft);
      this.drafts.update((list) => [draft, ...list.filter((d) => d.id !== draft.id)]);
    }

    return draft;
  }

  /** Puts a resource document into the active draft (creates "Untitled draft" first if none is open). */
  async upsert(document: string, baseGeneration?: number): Promise<boolean> {
    return await this.patch({
      set: [{ op: 'upsert', document, ...(baseGeneration !== undefined ? { baseGeneration } : {}) }],
    });
  }

  async remove(ref: ResourceKey): Promise<boolean> {
    const op: DraftOpInput = {
      op: 'delete',
      kind: ref.kind,
      name: ref.name,
      ...(ref.project ? { project: ref.project } : {}),
    };

    return await this.patch({ set: [op] });
  }

  /** Drops the draft's op of a resource (undo for that resource). */
  async revert(ref: ResourceKey): Promise<boolean> {
    return await this.patch({ remove: [draftOpKey(ref)] });
  }

  async rename(title: string): Promise<boolean> {
    return await this.patch({ title });
  }

  /**
   * Rebase of a conflicting op: `keep` re-bases the draft's version on the current generation, `take` drops it (the
   * cluster's version wins).
   */
  async resolve(conflict: DraftConflict, choice: 'keep' | 'take'): Promise<boolean> {
    const op = this.active()?.ops.find((o) => draftOpKey(o) === conflict.key);

    if (!op) return false;

    const ok =
      choice === 'take'
        ? await this.patch({ remove: [conflict.key] })
        : await this.patch({
            set: [
              op.op === 'upsert'
                ? { op: 'upsert', document: op.document, baseGeneration: conflict.currentGeneration }
                : {
                    op: 'delete',
                    kind: op.kind,
                    name: op.name,
                    ...(op.project ? { project: op.project } : {}),
                    baseGeneration: conflict.currentGeneration,
                  },
            ],
          });

    if (ok) this.conflicts.update((list) => list.filter((c) => c.key !== conflict.key));

    return ok;
  }

  async runPreview(): Promise<DraftPreview | null> {
    const draft = this.active();

    if (!draft) return null;

    const preview = await this.call(() => firstValueFrom(this.api.preview(draft.id)), null);

    this.preview.set(preview);
    this.conflicts.set(preview?.conflicts ?? []);

    return preview;
  }

  /** Submits the draft as a plan; conflicts (409) are listed for a rebase. */
  async submit(): Promise<Plan | null> {
    const draft = this.active();

    if (!draft) return null;

    this.busy.set(true);
    this.error.set(null);

    try {
      const plan = await firstValueFrom(this.api.submit(draft.id, draft.version));

      this.active.set(null);
      this.preview.set(null);
      this.drafts.update((list) => list.filter((d) => d.id !== draft.id));

      return plan;
    } catch (error) {
      this.conflicted(error);

      return null;
    } finally {
      this.busy.set(false);
    }
  }

  async discard(): Promise<boolean> {
    const draft = this.active();

    if (!draft) return false;

    const done = await this.call(() => firstValueFrom(this.api.discard(draft.id, draft.version)), null);

    if (done) {
      this.active.set(null);
      this.preview.set(null);
      this.drafts.update((list) => list.filter((d) => d.id !== draft.id));
    }

    return !!done;
  }

  dismissError(): void {
    this.error.set(null);
    this.changedByOthers.set(false);
  }

  private async patch(request: DraftPatchRequest): Promise<boolean> {
    let draft = this.active();

    if (!draft) draft = await this.create($localize`:@@lwConsoleWorkspace-untitledDraft:Untitled draft`);

    if (!draft) return false;

    this.busy.set(true);
    this.error.set(null);

    try {
      const next = await firstValueFrom(this.api.patch(draft.id, draft.version, request));

      this.active.set(next);
      this.preview.set(null);
      this.drafts.update((list) => [next, ...list.filter((d) => d.id !== next.id)]);

      return true;
    } catch (error) {
      this.conflicted(error);

      return false;
    } finally {
      this.busy.set(false);
    }
  }

  /** 409: a newer version (reload it, the user redoes the edit) or conflicting ops (listed for a rebase). */
  private conflicted(error: unknown): void {
    const body = error instanceof HttpErrorResponse ? (error.error as Record<string, unknown> | null) : null;

    if (error instanceof HttpErrorResponse && error.status === 409 && body?.['draft']) {
      this.active.set(body['draft'] as Draft);
      this.error.set(
        $localize`:@@lwConsoleWorkspace-draftChanged:Someone changed this draft in the meantime. It was reloaded; please repeat your last edit.`,
      );

      return;
    }

    if (error instanceof HttpErrorResponse && error.status === 409 && Array.isArray(body?.['conflicts'])) {
      this.conflicts.set(body['conflicts'] as DraftConflict[]);
      this.error.set(
        $localize`:@@lwConsoleWorkspace-draftConflicts:Resources in this draft changed in the cluster since you edited them. Keep your version or take the current one.`,
      );

      return;
    }

    this.error.set(apiErrorMessage(error));
  }

  private async call<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    this.busy.set(true);
    this.error.set(null);

    try {
      return await fn();
    } catch (error) {
      this.conflicted(error);

      return fallback;
    } finally {
      this.busy.set(false);
    }
  }
}
