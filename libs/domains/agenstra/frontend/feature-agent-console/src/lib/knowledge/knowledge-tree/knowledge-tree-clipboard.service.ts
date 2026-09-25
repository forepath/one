import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  KnowledgeFacade,
  deleteKnowledgeNodeFailure,
  deleteKnowledgeNodeSuccess,
  duplicateKnowledgeNodeFailure,
  duplicateKnowledgeNodeSuccess,
  updateKnowledgeNodeFailure,
  updateKnowledgeNodeSuccess,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import { Actions, ofType } from '@ngrx/effects';
import {
  Observable,
  Subject,
  catchError,
  concatMap,
  filter,
  finalize,
  firstValueFrom,
  from,
  map,
  of,
  take,
} from 'rxjs';

import { suggestNumberedTitle } from '../../file-editor/file-tree/file-tree-selection.util';
import {
  type KnowledgeTreeClipboardEntry,
  type KnowledgeTreeClipboardState,
  wouldMoveKnowledgeIntoSelf,
} from './knowledge-tree-clipboard.util';

export interface KnowledgeTreePasteMove {
  sourceId: string;
  destinationParentId: string | null;
  resultId: string;
  mode: 'copy' | 'cut';
}

export interface KnowledgeTreePasteResult {
  mode: 'copy' | 'cut';
  moves: KnowledgeTreePasteMove[];
}

export type KnowledgeTreeNameCollisionChoice = 'replace' | 'keepBoth';

export type KnowledgeTreeResolveNameCollision = (
  title: string,
  existingType: 'folder' | 'page',
) => Promise<KnowledgeTreeNameCollisionChoice>;

export interface KnowledgeTreeSiblingInfo {
  id: string;
  title: string;
  nodeType: 'folder' | 'page';
}

export type KnowledgeTreeListSiblings = (parentId: string | null) => KnowledgeTreeSiblingInfo[];

export type KnowledgeTreeGetNodeContent = (id: string) => string | null | undefined;

@Injectable()
export class KnowledgeTreeClipboardService {
  private readonly knowledgeFacade = inject(KnowledgeFacade);
  private readonly actions$ = inject(Actions);
  private readonly destroyRef = inject(DestroyRef);

  readonly clipboard = signal<KnowledgeTreeClipboardState | null>(null);
  readonly busy = signal(false);
  readonly lastError = signal<string | null>(null);

  private readonly queue$ = new Subject<() => Observable<unknown>>();
  private resolveNameCollision: KnowledgeTreeResolveNameCollision | null = null;
  private listSiblings: KnowledgeTreeListSiblings | null = null;
  private getNodeContent: KnowledgeTreeGetNodeContent | null = null;

  constructor() {
    this.queue$
      .pipe(
        concatMap((run) => {
          this.busy.set(true);
          this.lastError.set(null);

          return run().pipe(
            catchError((error: unknown) => {
              const message = error instanceof Error ? error.message : String(error);

              this.lastError.set(message);

              return of(null);
            }),
            finalize(() => this.busy.set(false)),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();
  }

  setCollisionHelpers(options: {
    resolveNameCollision: KnowledgeTreeResolveNameCollision | null;
    listSiblings: KnowledgeTreeListSiblings | null;
    getNodeContent: KnowledgeTreeGetNodeContent | null;
  }): void {
    this.resolveNameCollision = options.resolveNameCollision;
    this.listSiblings = options.listSiblings;
    this.getNodeContent = options.getNodeContent;
  }

  setClipboard(mode: 'copy' | 'cut', entries: KnowledgeTreeClipboardEntry[]): void {
    if (entries.length === 0) {
      this.clipboard.set(null);

      return;
    }

    this.clipboard.set({ mode, entries: [...entries] });
  }

  clearClipboard(): void {
    this.clipboard.set(null);
  }

  enqueueDelete(
    ids: string[],
    options?: { releaseExternalSyncMarker?: boolean },
    onDone?: (deleted: string[]) => void,
  ): void {
    this.enqueue(() =>
      from(this.runDelete(ids, options?.releaseExternalSyncMarker === true)).pipe(
        map((deleted) => {
          onDone?.(deleted);

          return deleted;
        }),
      ),
    );
  }

  enqueuePaste(
    targetParentId: string | null,
    resolveParentId: (id: string) => string | null | undefined,
    onDone?: (result: KnowledgeTreePasteResult) => void,
  ): void {
    const state = this.clipboard();

    if (!state || state.entries.length === 0) {
      return;
    }

    this.enqueue(() =>
      from(this.runPaste(targetParentId, state, resolveParentId)).pipe(
        map((result) => {
          if (state.mode === 'cut') {
            this.clearClipboard();
          }

          onDone?.(result);

          return result;
        }),
      ),
    );
  }

  private enqueue(run: () => Observable<unknown>): void {
    this.queue$.next(run);
  }

  private async runDelete(ids: string[], releaseExternalSyncMarker: boolean): Promise<string[]> {
    const deleted: string[] = [];

    for (const id of ids) {
      await this.awaitFacadeDelete(id, releaseExternalSyncMarker);
      deleted.push(id);
    }

    return deleted;
  }

  private async runPaste(
    targetParentId: string | null,
    state: KnowledgeTreeClipboardState,
    resolveParentId: (id: string) => string | null | undefined,
  ): Promise<KnowledgeTreePasteResult> {
    const moves: KnowledgeTreePasteMove[] = [];
    const siblings = [...(this.listSiblings?.(targetParentId) ?? [])];
    const claimedTitles = new Set(siblings.map((row) => row.title.toLowerCase()));

    for (const entry of state.entries) {
      if (state.mode === 'cut') {
        if (wouldMoveKnowledgeIntoSelf(entry.id, targetParentId, resolveParentId)) {
          throw new Error(`Cannot move "${entry.title}" into itself`);
        }

        const currentParent = entry.parentId ?? null;

        if (currentParent === targetParentId) {
          continue;
        }

        const colliding = this.findSiblingByTitle(siblings, entry.title);

        if (colliding && colliding.id !== entry.id) {
          const numbered = suggestNumberedTitle(entry.title, claimedTitles);

          await this.awaitFacadeUpdate(entry.id, { parentId: targetParentId, title: numbered });
          claimedTitles.add(numbered.toLowerCase());
          siblings.push({ id: entry.id, title: numbered, nodeType: entry.nodeType });
        } else {
          await this.awaitFacadeMove(entry.id, targetParentId);
          claimedTitles.add(entry.title.toLowerCase());
          siblings.push({ id: entry.id, title: entry.title, nodeType: entry.nodeType });
        }

        moves.push({
          sourceId: entry.id,
          destinationParentId: targetParentId,
          resultId: entry.id,
          mode: 'cut',
        });
      } else {
        const colliding = this.findSiblingByTitle(
          siblings.filter((row) => row.id !== entry.id),
          entry.title,
        );

        if (colliding?.nodeType === 'page' && entry.nodeType === 'page') {
          const choice = this.resolveNameCollision ? await this.resolveNameCollision(entry.title, 'page') : 'keepBoth';

          if (choice === 'replace') {
            const content = this.getNodeContent?.(entry.id) ?? '';

            await this.awaitFacadeUpdate(colliding.id, { content });
            moves.push({
              sourceId: entry.id,
              destinationParentId: targetParentId,
              resultId: colliding.id,
              mode: 'copy',
            });
            continue;
          }
        }

        const duplicated = await this.awaitFacadeDuplicate(entry.id);
        const needsMove = (duplicated.parentId ?? null) !== targetParentId;

        if (needsMove) {
          await this.awaitFacadeMove(duplicated.id, targetParentId);
        }

        // Duplicate numbers under the source parent when the original title exists there.
        // After moving to another folder, restore the original title when it is free at the destination.
        let resultTitle = duplicated.title;

        if (needsMove) {
          const originalTakenAtTarget = siblings.some(
            (row) => row.id !== entry.id && row.title.toLowerCase() === entry.title.toLowerCase(),
          );

          if (!originalTakenAtTarget) {
            if (resultTitle.toLowerCase() !== entry.title.toLowerCase()) {
              resultTitle = entry.title;
              await this.awaitFacadeUpdate(duplicated.id, { title: resultTitle });
            }
          } else {
            resultTitle = suggestNumberedTitle(entry.title, claimedTitles);

            if (resultTitle.toLowerCase() !== duplicated.title.toLowerCase()) {
              await this.awaitFacadeUpdate(duplicated.id, { title: resultTitle });
            }
          }
        }

        claimedTitles.add(resultTitle.toLowerCase());
        siblings.push({ id: duplicated.id, title: resultTitle, nodeType: entry.nodeType });
        moves.push({
          sourceId: entry.id,
          destinationParentId: targetParentId,
          resultId: duplicated.id,
          mode: 'copy',
        });
      }
    }

    return { mode: state.mode, moves };
  }

  private findSiblingByTitle(siblings: KnowledgeTreeSiblingInfo[], title: string): KnowledgeTreeSiblingInfo | null {
    const lower = title.toLowerCase();

    return siblings.find((row) => row.title.toLowerCase() === lower) ?? null;
  }

  private awaitFacadeDelete(id: string, releaseExternalSyncMarker: boolean): Promise<void> {
    const done = firstValueFrom(
      this.actions$.pipe(
        ofType(deleteKnowledgeNodeSuccess, deleteKnowledgeNodeFailure),
        filter((action) => action.id === id),
        take(1),
        map((action) => {
          if (action.type === deleteKnowledgeNodeFailure.type) {
            throw new Error(action.error);
          }
        }),
      ),
    );

    this.knowledgeFacade.deleteNode(id, releaseExternalSyncMarker || undefined);

    return done;
  }

  private awaitFacadeDuplicate(id: string): Promise<{ id: string; parentId: string | null; title: string }> {
    const done = firstValueFrom(
      this.actions$.pipe(
        ofType(duplicateKnowledgeNodeSuccess, duplicateKnowledgeNodeFailure),
        filter((action) => action.sourceId === id),
        take(1),
        map((action) => {
          if (action.type === duplicateKnowledgeNodeFailure.type) {
            throw new Error(action.error);
          }

          return {
            id: action.node.id,
            parentId: action.node.parentId ?? null,
            title: action.node.title,
          };
        }),
      ),
    );

    this.knowledgeFacade.duplicateNode(id);

    return done;
  }

  private awaitFacadeMove(id: string, parentId: string | null): Promise<void> {
    return this.awaitFacadeUpdate(id, { parentId });
  }

  private awaitFacadeUpdate(
    id: string,
    dto: { parentId?: string | null; title?: string; content?: string | null },
  ): Promise<void> {
    const done = firstValueFrom(
      this.actions$.pipe(
        ofType(updateKnowledgeNodeSuccess, updateKnowledgeNodeFailure),
        filter((action) => ('node' in action ? action.node.id === id : action.id === id)),
        take(1),
        map((action) => {
          if (action.type === updateKnowledgeNodeFailure.type) {
            throw new Error(action.error);
          }
        }),
      ),
    );

    this.knowledgeFacade.updateNode(id, dto);

    return done;
  }
}
