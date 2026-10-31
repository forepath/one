import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';

import { GitService } from '../../services/git.service';
import type {
  CreateGitConnectionRequest,
  GitConnection,
  GitConnectionActionKind,
  UpdateGitConnectionRequest,
} from '../../types/git.types';
import {
  clearGitActionResult,
  clearGitSave,
  createGitConnection,
  deleteGitConnection,
  hideGitWebhookSecret,
  loadGitCommits,
  loadGitConnections,
  loadGitSopsRecipient,
  revealGitWebhookSecret,
  rotateGitWebhookSecret,
  runGitConnectionAction,
  updateGitConnection,
} from './git.actions';
import {
  selectGitActing,
  selectGitActionError,
  selectGitActionResult,
  selectGitCommits,
  selectGitCommitsError,
  selectGitCommitsLoading,
  selectGitConnections,
  selectGitConnectionsError,
  selectGitConnectionsLoaded,
  selectGitConnectionsLoading,
  selectGitCreated,
  selectGitDeleteError,
  selectGitDeleting,
  selectGitSaved,
  selectGitSaveError,
  selectGitSaving,
  selectGitSopsError,
  selectGitSopsLoaded,
  selectGitSopsRecipient,
  selectGitSopsUnavailable,
  selectGitWebhookSecret,
  selectGitWebhookSecretError,
  selectGitWebhookSecretLoading,
  selectGitWebhookSecretRotating,
} from './git.selectors';

/** GitOps (3.29): connections per scope, their commits and actions, and the cluster's SOPS recipient. */
@Injectable()
export class ConsoleGitFacade {
  private readonly store = inject(Store);
  private readonly service = inject(GitService);

  readonly connections$ = this.store.select(selectGitConnections);
  readonly loaded$ = this.store.select(selectGitConnectionsLoaded);
  readonly loading$ = this.store.select(selectGitConnectionsLoading);
  readonly error$ = this.store.select(selectGitConnectionsError);
  readonly commits$ = this.store.select(selectGitCommits);
  readonly commitsLoading$ = this.store.select(selectGitCommitsLoading);
  readonly commitsError$ = this.store.select(selectGitCommitsError);
  readonly saving$ = this.store.select(selectGitSaving);
  readonly saveError$ = this.store.select(selectGitSaveError);
  readonly saved$ = this.store.select(selectGitSaved);
  readonly created$ = this.store.select(selectGitCreated);
  readonly deleting$ = this.store.select(selectGitDeleting);
  readonly deleteError$ = this.store.select(selectGitDeleteError);
  readonly acting$ = this.store.select(selectGitActing);
  readonly actionError$ = this.store.select(selectGitActionError);
  readonly actionResult$ = this.store.select(selectGitActionResult);
  readonly webhookSecret$ = this.store.select(selectGitWebhookSecret);
  readonly webhookSecretLoading$ = this.store.select(selectGitWebhookSecretLoading);
  readonly webhookSecretRotating$ = this.store.select(selectGitWebhookSecretRotating);
  readonly webhookSecretError$ = this.store.select(selectGitWebhookSecretError);
  readonly sopsRecipient$ = this.store.select(selectGitSopsRecipient);
  readonly sopsLoaded$ = this.store.select(selectGitSopsLoaded);
  readonly sopsError$ = this.store.select(selectGitSopsError);
  readonly sopsUnavailable$ = this.store.select(selectGitSopsUnavailable);

  /** `silent`: in the background (plans, drift and the editor read the connections for links and the mode). */
  load(silent = false): void {
    this.store.dispatch(loadGitConnections({ silent }));
  }

  loadCommits(id: string, silent = false): void {
    this.store.dispatch(loadGitCommits({ id, silent }));
  }

  create(request: CreateGitConnectionRequest): void {
    this.store.dispatch(createGitConnection({ request }));
  }

  update(id: string, request: UpdateGitConnectionRequest): void {
    this.store.dispatch(updateGitConnection({ id, request }));
  }

  clearSave(): void {
    this.store.dispatch(clearGitSave());
  }

  remove(id: string): void {
    this.store.dispatch(deleteGitConnection({ id }));
  }

  run(id: string, action: GitConnectionActionKind, force = false): void {
    this.store.dispatch(runGitConnectionAction({ id, action, ...(force ? { force: true } : {}) }));
  }

  clearActionResult(): void {
    this.store.dispatch(clearGitActionResult());
  }

  revealWebhookSecret(id: string): void {
    this.store.dispatch(revealGitWebhookSecret({ id }));
  }

  /** A new webhook secret (audited); the current one stops working immediately. */
  rotateWebhookSecret(id: string): void {
    this.store.dispatch(rotateGitWebhookSecret({ id }));
  }

  hideWebhookSecret(): void {
    this.store.dispatch(hideGitWebhookSecret());
  }

  loadSopsRecipient(): void {
    this.store.dispatch(loadGitSopsRecipient());
  }

  /** The absolute URL to configure as the repository's push webhook. */
  webhookUrl(connection: Pick<GitConnection, 'webhookPath'>): string {
    return this.service.webhookUrl(connection);
  }
}
