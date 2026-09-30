import { Injectable, computed, signal } from '@angular/core';

type ScopeOpenOverride = string | null | undefined;

interface TodosExpandScopeState {
  nextSeq: number;
  registrations: ReadonlyMap<string, number>;
  /**
   * `undefined` — open the latest registered todos row in this message.
   * `null` — all todos in this message collapsed.
   * `string` — that trackId is open (manual toggle).
   */
  openOverride: ScopeOpenOverride;
}

/**
 * Ensures only the most recent Todos embed **per chat message** is auto-expanded.
 * Provided per chat host so concurrent chat views do not share open state.
 */
@Injectable()
export class AgentChatTodosExpandCoordinator {
  private readonly scopes = signal<ReadonlyMap<string, TodosExpandScopeState>>(new Map());

  /** Bumps whenever any scope changes so row computeds can refresh. */
  readonly revision = computed(() => {
    let n = 0;

    for (const scope of this.scopes().values()) {
      n += scope.nextSeq * 31 + scope.registrations.size;

      if (scope.openOverride === null) {
        n += 7;
      } else if (typeof scope.openOverride === 'string') {
        n += scope.openOverride.length;
      }
    }

    return n;
  });

  latestTrackId(scopeId: string): string | null {
    void this.revision();

    const scope = this.scopes().get(scopeId);

    if (!scope) {
      return null;
    }

    let bestId: string | null = null;
    let bestSeq = -1;

    for (const [trackId, seq] of scope.registrations) {
      if (seq > bestSeq) {
        bestSeq = seq;
        bestId = trackId;
      }
    }

    return bestId;
  }

  /** Register a todos row within a message scope. Re-claims for the same trackId are ignored. */
  claim(scopeId: string, trackId: string): void {
    const current = this.scopes();
    const scope = current.get(scopeId) ?? {
      nextSeq: 0,
      registrations: new Map<string, number>(),
      openOverride: undefined as ScopeOpenOverride,
    };

    if (scope.registrations.has(trackId)) {
      return;
    }

    const nextSeq = scope.nextSeq + 1;
    const registrations = new Map(scope.registrations);

    registrations.set(trackId, nextSeq);

    const nextScopes = new Map(current);

    nextScopes.set(scopeId, {
      nextSeq,
      registrations,
      // New latest todos in this message → auto-expand it (closes earlier ones in the same message).
      openOverride: undefined,
    });
    this.scopes.set(nextScopes);
  }

  release(scopeId: string, trackId: string): void {
    const current = this.scopes();
    const scope = current.get(scopeId);

    if (!scope?.registrations.has(trackId)) {
      return;
    }

    const registrations = new Map(scope.registrations);

    registrations.delete(trackId);

    const nextScopes = new Map(current);

    if (registrations.size === 0) {
      nextScopes.delete(scopeId);
    } else {
      nextScopes.set(scopeId, {
        ...scope,
        registrations,
        openOverride: scope.openOverride === trackId ? undefined : scope.openOverride,
      });
    }

    this.scopes.set(nextScopes);
  }

  isOpen(scopeId: string, trackId: string): boolean {
    void this.revision();

    const scope = this.scopes().get(scopeId);

    if (!scope) {
      return false;
    }

    if (scope.openOverride === null) {
      return false;
    }

    if (typeof scope.openOverride === 'string') {
      return scope.openOverride === trackId;
    }

    return this.latestTrackId(scopeId) === trackId;
  }

  toggle(scopeId: string, trackId: string): void {
    if (this.isOpen(scopeId, trackId)) {
      this.patchScope(scopeId, (scope) => ({ ...scope, openOverride: null }));

      return;
    }

    this.patchScope(scopeId, (scope) => ({ ...scope, openOverride: trackId }));
  }

  private patchScope(scopeId: string, update: (scope: TodosExpandScopeState) => TodosExpandScopeState): void {
    const current = this.scopes();
    const scope = current.get(scopeId) ?? {
      nextSeq: 0,
      registrations: new Map<string, number>(),
      openOverride: undefined as ScopeOpenOverride,
    };
    const nextScopes = new Map(current);

    nextScopes.set(scopeId, update(scope));
    this.scopes.set(nextScopes);
  }
}
