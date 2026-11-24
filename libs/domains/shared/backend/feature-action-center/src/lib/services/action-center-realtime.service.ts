import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { Socket } from 'socket.io';

import {
  ACTION_CENTER_ERROR_EVENT,
  ACTION_CENTER_RECOMPUTE_DEBOUNCE,
  ACTION_CENTER_REFRESH,
  ACTION_CENTER_REVISION_POLL,
  ACTION_CENTER_SESSION_REVALIDATE,
  ACTION_CENTER_SNAPSHOT_EVENT,
  readActionCenterInterval,
} from '../constants/action-center.constants';
import type { ActionCenterSilenceEntity } from '../entities/action-center-silence.entity';
import type { ActionCenterView, ActionCenterViewer } from '../interfaces/action-center.types';
import { buildActionCenterView, fingerprintActionCenter } from '../utils/action-center-view.utils';

import { ActionCenterRevisionStore } from './action-center-revision.store';
import { ActionCenterSilencesService } from './action-center-silences.service';
import { ActionCenterService } from './action-center.service';

/** Minimum time between two recomputes of one scope. */
const MIN_RECOMPUTE_INTERVAL_MS = 2_000;
/** The periodic refresh of watched scopes is spread over this window. */
const REFRESH_SPREAD_MS = 5_000;

/** Re-checks a connected session; `null` ends it (expired, locked, revoked or no longer admin / manager). */
export type ActionCenterSessionRevalidator = () => Promise<ActionCenterViewer | null>;

export interface ActionCenterSocketSession {
  socket: Pick<Socket, 'id' | 'emit' | 'disconnect'>;
  viewer: ActionCenterViewer;
  revalidate: ActionCenterSessionRevalidator;
  /** Fingerprint of the last view sent (only changed views are emitted). */
  lastViewFingerprint?: string;
}

/**
 * Live delivery of action center views to the sockets of this process.
 *
 * - local changes (`ActionCenterService.signalChange`) → debounced recompute of the scope
 * - changes in other processes (queue workers, API replicas) → revision poll on Valkey
 * - time-based conditions (overdue, expiring) → periodic full refresh of watched scopes
 * - every session is re-validated periodically and disconnected when it lost access
 *
 * Every socket receives its own view (roles and silences differ) and only when that view changed.
 */
@Injectable()
export class ActionCenterRealtimeService implements OnModuleDestroy {
  private readonly logger = new Logger(ActionCenterRealtimeService.name);
  private readonly sessions = new Map<string, ActionCenterSocketSession>();
  private readonly debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly refreshing = new Map<string, Promise<void>>();
  private readonly rerun = new Set<string>();
  private readonly seenRevisions = new Map<string, string | null>();
  /** Start of the last recompute per scope (minimum interval between recomputes). */
  private readonly lastRefreshAt = new Map<string, number>();
  private readonly timers: ReturnType<typeof setInterval>[] = [];
  private unsubscribe: (() => void) | null = null;
  private attached = false;
  private revisionPollRunning = false;
  private revalidateRunning = false;

  constructor(
    private readonly actionCenter: ActionCenterService,
    private readonly silences: ActionCenterSilencesService,
    private readonly revisions: ActionCenterRevisionStore,
  ) {}

  /** Starts change tracking; called by the gateway once its server exists (API processes only). */
  attach(): void {
    if (this.attached) {
      return;
    }

    this.attached = true;
    this.unsubscribe = this.actionCenter.onChange((scopeKey) => this.schedule(scopeKey));
    this.timers.push(
      setInterval(() => void this.pollRevisions(), readActionCenterInterval(ACTION_CENTER_REVISION_POLL)),
      setInterval(() => this.refreshAllScopes(), readActionCenterInterval(ACTION_CENTER_REFRESH)),
      setInterval(() => void this.revalidateSessions(), readActionCenterInterval(ACTION_CENTER_SESSION_REVALIDATE)),
    );

    for (const timer of this.timers) {
      timer.unref?.();
    }

    this.logger.log('Action center realtime attached');
  }

  isAttached(): boolean {
    return this.attached;
  }

  /** Registers a session; `false` when the socket is already registered (e.g. a second gateway instance). */
  register(session: ActionCenterSocketSession): boolean {
    if (this.sessions.has(session.socket.id)) {
      return false;
    }

    this.sessions.set(session.socket.id, session);

    if (!this.seenRevisions.has(session.viewer.scopeKey)) {
      // Remember the current revision so only later changes trigger a recompute.
      void this.revisions
        .read([session.viewer.scopeKey])
        .then((values) => this.seenRevisions.set(session.viewer.scopeKey, values.get(session.viewer.scopeKey) ?? null));
    }

    return true;
  }

  unregister(socketId: string): void {
    const session = this.sessions.get(socketId);

    this.sessions.delete(socketId);

    if (session && !this.hasSessionsInScope(session.viewer.scopeKey)) {
      this.seenRevisions.delete(session.viewer.scopeKey);
      this.lastRefreshAt.delete(session.viewer.scopeKey);
    }
  }

  /** Sends the socket its current view (e.g. right after connecting), regardless of what it saw before. */
  async pushToSocket(socketId: string): Promise<void> {
    const session = this.sessions.get(socketId);

    if (!session) {
      return;
    }

    try {
      const [snapshot, silences] = await Promise.all([
        this.actionCenter.getSnapshot(session.viewer.scopeKey),
        this.silences.listForScope(session.viewer.scopeKey),
      ]);

      this.emitView(session, buildActionCenterView(snapshot, session.viewer, silences, new Date()), true);
    } catch (error) {
      this.logger.warn(`Action center initial push failed: ${(error as Error)?.message ?? error}`);
      session.socket.emit(ACTION_CENTER_ERROR_EVENT, { message: 'Failed to load action center' });
    }
  }

  /** Debounced recompute + delivery for a scope that has viewers in this process. */
  schedule(scopeKey: string, extraDelayMs = 0): void {
    if (!this.attached || !this.hasSessionsInScope(scopeKey) || this.debounceTimers.has(scopeKey)) {
      return;
    }

    // Trailing debounce, and never more often than every MIN_RECOMPUTE_INTERVAL_MS per scope: a burst of changes
    // (bulk actions, chatty events) costs one recompute.
    const sinceLast = Date.now() - (this.lastRefreshAt.get(scopeKey) ?? 0);
    const delay = Math.max(
      readActionCenterInterval(ACTION_CENTER_RECOMPUTE_DEBOUNCE) + extraDelayMs,
      MIN_RECOMPUTE_INTERVAL_MS - sinceLast,
    );
    const timer = setTimeout(() => {
      this.debounceTimers.delete(scopeKey);
      void this.refreshScope(scopeKey);
    }, delay);

    timer.unref?.();
    this.debounceTimers.set(scopeKey, timer);
  }

  /** Recomputes a scope and sends every viewer whose view changed; overlapping calls are coalesced. */
  async refreshScope(scopeKey: string): Promise<void> {
    const running = this.refreshing.get(scopeKey);

    if (running) {
      this.rerun.add(scopeKey);

      return await running;
    }

    const promise = this.runRefresh(scopeKey).finally(() => {
      this.refreshing.delete(scopeKey);

      if (this.rerun.delete(scopeKey)) {
        void this.refreshScope(scopeKey);
      }
    });

    this.refreshing.set(scopeKey, promise);

    return await promise;
  }

  onModuleDestroy(): void {
    for (const timer of this.timers) {
      clearInterval(timer);
    }

    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }

    this.timers.length = 0;
    this.debounceTimers.clear();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.attached = false;
  }

  private async runRefresh(scopeKey: string): Promise<void> {
    this.lastRefreshAt.set(scopeKey, Date.now());

    const sessions = this.sessionsInScope(scopeKey);

    if (sessions.length === 0) {
      return;
    }

    let silences: ActionCenterSilenceEntity[];

    try {
      const [, loaded] = await Promise.all([
        this.actionCenter.getSnapshot(scopeKey),
        this.silences.listForScope(scopeKey),
      ]);

      silences = loaded;
    } catch (error) {
      this.logger.warn(`Action center refresh of scope ${scopeKey} failed: ${(error as Error)?.message ?? error}`);

      return;
    }

    const snapshot = this.actionCenter.peekSnapshot(scopeKey);

    if (!snapshot) {
      return;
    }

    const now = new Date();

    for (const session of this.sessionsInScope(scopeKey)) {
      this.emitView(session, buildActionCenterView(snapshot, session.viewer, silences, now), false);
    }
  }

  private emitView(session: ActionCenterSocketSession, view: ActionCenterView, force: boolean): void {
    // `generatedAt` changes on every recompute; only the content decides whether the viewer needs an update.
    const fingerprint = fingerprintActionCenter({ ...view, generatedAt: undefined });

    if (!force && fingerprint === session.lastViewFingerprint) {
      return;
    }

    session.lastViewFingerprint = fingerprint;
    session.socket.emit(ACTION_CENTER_SNAPSHOT_EVENT, view);
  }

  private async pollRevisions(): Promise<void> {
    if (this.revisionPollRunning) {
      return;
    }

    const scopeKeys = this.activeScopeKeys();

    if (scopeKeys.length === 0 || !this.revisions.isEnabled()) {
      return;
    }

    this.revisionPollRunning = true;

    try {
      const current = await this.revisions.read(scopeKeys);

      for (const scopeKey of scopeKeys) {
        if (!current.has(scopeKey)) {
          continue;
        }

        const revision = current.get(scopeKey) ?? null;
        const seen = this.seenRevisions.get(scopeKey);

        this.seenRevisions.set(scopeKey, revision);

        if (seen !== undefined && seen !== revision && !this.revisions.isOwnRevision(revision)) {
          this.actionCenter.markStale(scopeKey);
          this.schedule(scopeKey);
        }
      }
    } finally {
      this.revisionPollRunning = false;
    }
  }

  /** Periodic refresh, spread over a few seconds so many watched scopes do not recompute at the same instant. */
  private refreshAllScopes(): void {
    for (const scopeKey of this.activeScopeKeys()) {
      this.actionCenter.markStale(scopeKey);
      this.schedule(scopeKey, Math.floor(Math.random() * REFRESH_SPREAD_MS));
    }
  }

  private async revalidateSessions(): Promise<void> {
    if (this.revalidateRunning || this.sessions.size === 0) {
      return;
    }

    this.revalidateRunning = true;

    try {
      for (const session of [...this.sessions.values()]) {
        let viewer: ActionCenterViewer | null = null;

        try {
          viewer = await session.revalidate();
        } catch (error) {
          this.logger.debug(`Action center session check failed: ${(error as Error)?.message ?? error}`);
        }

        if (!this.sessions.has(session.socket.id)) {
          continue;
        }

        if (!viewer || viewer.userId !== session.viewer.userId || viewer.scopeKey !== session.viewer.scopeKey) {
          session.socket.emit(ACTION_CENTER_ERROR_EVENT, { message: 'Session no longer valid' });
          session.socket.disconnect(true);
          this.unregister(session.socket.id);
          continue;
        }

        if (viewer.role !== session.viewer.role) {
          session.viewer = viewer;
          void this.pushToSocket(session.socket.id);
        }
      }
    } finally {
      this.revalidateRunning = false;
    }
  }

  private sessionsInScope(scopeKey: string): ActionCenterSocketSession[] {
    return [...this.sessions.values()].filter((session) => session.viewer.scopeKey === scopeKey);
  }

  private hasSessionsInScope(scopeKey: string): boolean {
    for (const session of this.sessions.values()) {
      if (session.viewer.scopeKey === scopeKey) {
        return true;
      }
    }

    return false;
  }

  private activeScopeKeys(): string[] {
    return [...new Set([...this.sessions.values()].map((session) => session.viewer.scopeKey))];
  }
}
