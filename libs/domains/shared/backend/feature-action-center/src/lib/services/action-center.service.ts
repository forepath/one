import { Inject, Injectable, Logger } from '@nestjs/common';

import { ACTION_CENTER_MODULE_OPTIONS, ACTION_CENTER_SOURCE_ITEM_LIMIT } from '../constants/action-center.constants';
import type { CreateActionCenterSilenceDto } from '../dto/action-center.dto';
import type { ActionCenterSilenceEntity } from '../entities/action-center-silence.entity';
import type { ActionCenterModuleOptions } from '../interfaces/action-center-module.options';
import type {
  ActionCenterGroupDraft,
  ActionCenterSilenceChange,
  ActionCenterSource,
  ActionCenterSnapshot,
  ActionCenterView,
  ActionCenterViewer,
} from '../interfaces/action-center.types';
import { buildActionCenterView, createActionCenterSnapshot } from '../utils/action-center-view.utils';

import { ActionCenterRegistry } from './action-center-registry.service';
import { ActionCenterRevisionStore } from './action-center-revision.store';
import { ActionCenterSilencesService } from './action-center-silences.service';

/** A cached snapshot younger than this is reused for REST reads unless a change was signalled. */
const SNAPSHOT_REUSE_MS = 5_000;
/** Coalesces revision writes of one scope (bulk operations signal many changes in a row). */
const REVISION_BUMP_THROTTLE_MS = 250;

interface CachedSnapshot {
  snapshot: ActionCenterSnapshot;
  computedAt: number;
  stale: boolean;
}

export type ActionCenterChangeListener = (scopeKey: string) => void;

export type ActionCenterSilenceListener = (change: ActionCenterSilenceChange) => void;

/**
 * Computes action center snapshots from the registered sources and turns them into per-viewer views.
 * Change signals (HTTP mutations, domain events, silences) invalidate the scope's snapshot, notify in-process
 * listeners (the realtime service) and write a revision for other processes.
 */
@Injectable()
export class ActionCenterService {
  private readonly logger = new Logger(ActionCenterService.name);
  private readonly cache = new Map<string, CachedSnapshot>();
  private readonly inFlight = new Map<string, { promise: Promise<ActionCenterSnapshot>; startedAt: number }>();
  /** Last change signal per scope (local or remote); computations started before it are outdated. */
  private readonly lastChangeAt = new Map<string, number>();
  private readonly listeners = new Set<ActionCenterChangeListener>();
  private readonly silenceListeners = new Set<ActionCenterSilenceListener>();
  private readonly pendingBumps = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    @Inject(ACTION_CENTER_MODULE_OPTIONS) private readonly options: ActionCenterModuleOptions,
    private readonly registry: ActionCenterRegistry,
    private readonly silences: ActionCenterSilencesService,
    private readonly revisions: ActionCenterRevisionStore,
  ) {}

  private readonly wiringClaims = new Set<string>();

  /**
   * Returns `true` for the first caller of `key` only. Product modules can be instantiated more than once in one
   * process (e.g. imported by the app and the queue module); their registrars use this to wire sources and
   * listeners exactly once.
   */
  claimWiring(key: string): boolean {
    if (this.wiringClaims.has(key)) {
      return false;
    }

    this.wiringClaims.add(key);

    return true;
  }

  get applicationId(): string {
    return this.options.applicationId;
  }

  /** Scope of the current request / job context. */
  currentScopeKey(): string {
    return this.options.resolveScopeKey();
  }

  onChange(listener: ActionCenterChangeListener): () => void {
    this.listeners.add(listener);

    return () => this.listeners.delete(listener);
  }

  /** Observers of silence changes (products publish them as webhook events). */
  onSilenceChange(listener: ActionCenterSilenceListener): () => void {
    this.silenceListeners.add(listener);

    return () => this.silenceListeners.delete(listener);
  }

  /**
   * Something that may affect to-dos changed in `scopeKey` (default: the current scope). Cheap and synchronous for
   * callers: listeners run immediately, the cross-process revision is written in the background.
   */
  signalChange(scopeKey: string = this.currentScopeKey()): void {
    this.markStale(scopeKey);

    for (const listener of this.listeners) {
      try {
        listener(scopeKey);
      } catch (error) {
        this.logger.warn(`Action center change listener failed: ${(error as Error)?.message ?? error}`);
      }
    }

    if (!this.pendingBumps.has(scopeKey)) {
      this.pendingBumps.set(
        scopeKey,
        setTimeout(() => {
          this.pendingBumps.delete(scopeKey);
          void this.revisions.bump(scopeKey);
        }, REVISION_BUMP_THROTTLE_MS),
      );
    }
  }

  /** Marks the cached snapshot of a scope outdated without notifying anyone (used for remote revisions). */
  markStale(scopeKey: string): void {
    this.lastChangeAt.set(scopeKey, Date.now());

    const cached = this.cache.get(scopeKey);

    if (cached) {
      cached.stale = true;
    }
  }

  async getSnapshot(
    scopeKey: string,
    options: { force?: boolean; retried?: boolean } = {},
  ): Promise<ActionCenterSnapshot> {
    const cached = this.cache.get(scopeKey);

    if (!options.force && cached && !cached.stale && Date.now() - cached.computedAt < SNAPSHOT_REUSE_MS) {
      return cached.snapshot;
    }

    const running = this.inFlight.get(scopeKey);

    if (running) {
      const snapshot = await running.promise;

      // A change arrived after that computation started: its result may be outdated, compute once more (only once,
      // so a steady stream of signals cannot starve the caller).
      return !options.retried && (this.lastChangeAt.get(scopeKey) ?? 0) >= running.startedAt
        ? await this.getSnapshot(scopeKey, { ...options, retried: true })
        : snapshot;
    }

    const startedAt = Date.now();
    const promise = this.compute(scopeKey, startedAt).finally(() => this.inFlight.delete(scopeKey));

    this.inFlight.set(scopeKey, { promise, startedAt });

    return await promise;
  }

  /** Last computed snapshot of a scope (no recompute). */
  peekSnapshot(scopeKey: string): ActionCenterSnapshot | null {
    return this.cache.get(scopeKey)?.snapshot ?? null;
  }

  async getView(viewer: ActionCenterViewer): Promise<ActionCenterView> {
    const [snapshot, silences] = await Promise.all([
      this.getSnapshot(viewer.scopeKey),
      this.silences.listForScope(viewer.scopeKey),
    ]);

    return buildActionCenterView(snapshot, viewer, silences, new Date());
  }

  /**
   * Silences a type / item for the viewer or (admins) everyone, pushes the change to every connected viewer and
   * returns the caller's updated view. Products call this from their `POST <path>/silences` route.
   */
  async silence(viewer: ActionCenterViewer, dto: CreateActionCenterSilenceDto): Promise<ActionCenterView> {
    const silence = await this.silences.create(viewer, dto);

    this.signalChange(viewer.scopeKey);
    this.notifySilenceChange('created', viewer, silence);

    return await this.getView(viewer);
  }

  /** Removes a silence (own ones; everyone silences: admins only); see {@link silence}. */
  async unsilence(viewer: ActionCenterViewer, silenceId: string): Promise<ActionCenterView> {
    const silence = await this.silences.remove(viewer, silenceId);

    this.signalChange(viewer.scopeKey);
    this.notifySilenceChange('removed', viewer, silence);

    return await this.getView(viewer);
  }

  private notifySilenceChange(
    change: ActionCenterSilenceChange['change'],
    actor: ActionCenterViewer,
    silence: ActionCenterSilenceEntity,
  ): void {
    const event: ActionCenterSilenceChange = {
      change,
      actor,
      silence: {
        id: silence.id,
        itemType: silence.itemType,
        itemId: silence.itemId,
        audience: silence.userId === null ? 'everyone' : 'self',
        until: silence.until ? silence.until.toISOString() : null,
      },
    };

    for (const listener of this.silenceListeners) {
      try {
        listener(event);
      } catch (error) {
        this.logger.warn(`Action center silence listener failed: ${(error as Error)?.message ?? error}`);
      }
    }
  }

  private async compute(scopeKey: string, startedAt: number): Promise<ActionCenterSnapshot> {
    const now = new Date(startedAt);
    const run = this.options.runInScope ?? (<T>(_scopeKey: string, fn: () => Promise<T>) => fn());
    const drafts = await run(scopeKey, async () => {
      // Sources run one after another (each with a few concurrent queries): a recompute never drains the pool.
      const results: Array<PromiseSettledResult<{ source: ActionCenterSource; groups: ActionCenterGroupDraft[] }>> = [];

      for (const source of this.registry.list()) {
        try {
          results.push({
            status: 'fulfilled',
            value: {
              source,
              groups: await source.collect({ scopeKey, itemLimit: ACTION_CENTER_SOURCE_ITEM_LIMIT, now }),
            },
          });
        } catch (reason) {
          results.push({ status: 'rejected', reason });
        }
      }

      const collected: ActionCenterGroupDraft[] = [];

      for (const result of results) {
        if (result.status === 'rejected') {
          this.logger.warn(
            `Action center source failed in scope ${scopeKey}: ${(result.reason as Error)?.message ?? result.reason}`,
          );
          continue;
        }

        for (const group of result.value.groups) {
          if (this.registry.isOwnType(result.value.source.key, group.type)) {
            collected.push(group);
          } else {
            this.logger.warn(`Action center source ${result.value.source.key} reported foreign type ${group.type}`);
          }
        }
      }

      return collected;
    });
    const snapshot = createActionCenterSnapshot(scopeKey, drafts, now);
    // Changes signalled while the sources ran keep the entry stale, so the next read recomputes.
    const changedMeanwhile = (this.lastChangeAt.get(scopeKey) ?? 0) >= startedAt;

    this.cache.set(scopeKey, { snapshot, computedAt: startedAt, stale: changedMeanwhile });

    return snapshot;
  }
}
