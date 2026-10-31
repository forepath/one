import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, input, model, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  ConsoleGitFacade,
  GIT_MODES,
  GIT_PROVIDERS,
  type GitConnection,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcButtonComponent,
  FpcFormCheckComponent,
  FpcFormCheckGroupComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcFormSwitchComponent,
  FpcInputGroupComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
} from '@forepath/shared/frontend/ui-components';

import { LoadweaverReferenceFieldComponent } from '../objects/reference-field.component';
import type { ReferenceTarget } from '../objects/reference-fields';
import { LoadweaverReferenceSource } from '../objects/reference-source';
import {
  createRequestOf,
  emptyGitForm,
  GIT_POLL_MAX,
  GIT_POLL_MIN,
  gitFormOf,
  githubAppResetByEdit,
  gitModeHint,
  gitModeLabel,
  gitProviderLabel,
  gitScopeLabel,
  type GitConnectionForm,
  type GitFormField,
  updateRequestOf,
  validateGitForm,
  webhookSecretHint,
} from './git-format';

/**
 * Connect a repository to a scope or change a connection (3.29): provider, repository URL (HTTPS or SSH), branch,
 * path, mode, credentials as a secret reference, trigger, plan bot options (the cluster's GitHub App for cluster
 * admins) and a private CA. A new connection's
 * webhook secret is shown once, with the URL to configure.
 */
@Component({
  selector: 'loadweaver-git-connection-modal',
  imports: [
    FpcFormFieldComponent,
    FpcFormControlComponent,
    FpcFormCheckComponent,
    FpcFormCheckGroupComponent,
    FpcFormSwitchComponent,
    FpcInputGroupComponent,
    CommonModule,
    FormsModule,
    FpcAlertComponent,
    FpcButtonComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    LoadweaverReferenceFieldComponent,
  ],
  templateUrl: './git-connection-modal.component.html',
  standalone: true,
  // The credentials' project picker (reference typeaheads, 2026-10-29) defaults to the connection's scope.
  providers: [LoadweaverReferenceSource],
})
export class LoadweaverGitConnectionModalComponent {
  private readonly facade = inject(ConsoleGitFacade);
  private readonly references = inject(LoadweaverReferenceSource);

  readonly secretTarget: ReferenceTarget = { type: 'secret' };
  readonly credentialsLabel = $localize`:@@lwConsoleGitConnection-credentials:Credentials (secret reference)`;

  readonly open = model(false);
  /** The edited connection; null to connect a new one. */
  readonly connection = input<GitConnection | null>(null);
  /** Scopes a new connection may be created for ('' = the cluster scope). */
  readonly scopes = input<string[]>([]);
  /** Only cluster admins may let a connection use the cluster's GitHub App. */
  readonly clusterAdmin = input(false);

  readonly saving = toSignal(this.facade.saving$, { initialValue: false });
  readonly saveError = toSignal(this.facade.saveError$, { initialValue: null });
  readonly saved = toSignal(this.facade.saved$, { initialValue: null });
  readonly created = toSignal(this.facade.created$, { initialValue: null });

  readonly form = signal<GitConnectionForm>(emptyGitForm());
  readonly invalid = signal<readonly GitFormField[]>([]);
  readonly nothingChanged = signal(false);
  readonly showAdvanced = signal(false);
  private submitted = false;

  readonly editing = computed(() => this.connection() !== null);
  /** The GitHub App option: editable for cluster admins, shown read-only to others while it is on. */
  readonly showGithubApp = computed(
    () => this.form().provider === 'github' && (this.clusterAdmin() || this.form().githubApp),
  );
  /** The edit points a connection that uses the GitHub App elsewhere: the control plane turns the app off. */
  readonly githubAppReset = computed(() => githubAppResetByEdit(this.form(), this.connection(), this.clusterAdmin()));
  readonly createdWebhookUrl = computed(() => {
    const created = this.created();

    return created ? this.facade.webhookUrl(created) : null;
  });

  readonly providers = GIT_PROVIDERS;
  readonly modes = GIT_MODES;
  readonly pollMin = GIT_POLL_MIN;
  readonly pollMax = GIT_POLL_MAX;
  readonly providerLabel = gitProviderLabel;
  readonly modeLabel = gitModeLabel;
  readonly modeHint = gitModeHint;
  readonly scopeLabel = gitScopeLabel;
  readonly webhookHint = webhookSecretHint;

  readonly createTitle = $localize`:@@lwConsoleGitConnection-createTitle:Connect a repository`;
  readonly editTitle = $localize`:@@lwConsoleGitConnection-editTitle:Edit the Git connection`;
  readonly createdTitle = $localize`:@@lwConsoleGitConnection-createdTitle:Repository connected`;

  constructor() {
    // Secrets of a project's connection live in that project ('' = the cluster scope: no default).
    effect(() => this.references.project.set(this.form().scope || null));

    // Every opening starts from the connection (or an empty form for the first free scope).
    effect(() => {
      if (!this.open()) return;

      const connection = this.connection();
      const scopes = this.scopes();

      untracked(() => {
        this.form.set(connection ? gitFormOf(connection) : emptyGitForm(scopes[0] ?? ''));
        this.invalid.set([]);
        this.nothingChanged.set(false);
        this.showAdvanced.set(!!connection?.apiUrl || !!connection?.caCertificate);
        this.submitted = false;
        this.facade.clearSave();
      });
    });

    // A saved edit closes the dialog; a new connection stays open to show its webhook secret once.
    effect(() => {
      const saved = this.saved();

      if (saved && this.submitted && this.editing() && !this.created()) untracked(() => this.close());
    });
  }

  update<K extends keyof GitConnectionForm>(key: K, value: GitConnectionForm[K]): void {
    this.form.update((form) => {
      const next = { ...form, [key]: value };

      // A new connection's path follows the scope until it is edited.
      if (key === 'scope' && !this.editing() && form.path === form.scope) next.path = String(value);

      return next;
    });

    if (this.invalid().length > 0) this.invalid.set(validateGitForm(this.form(), this.scopeCheck()));
  }

  isInvalid(field: GitFormField): boolean {
    return this.invalid().includes(field);
  }

  save(): void {
    const form = this.form();
    const invalid = validateGitForm(form, this.scopeCheck());

    this.invalid.set(invalid);
    this.nothingChanged.set(false);

    if (invalid.length > 0) return;

    const connection = this.connection();

    this.submitted = true;

    if (connection) {
      const request = updateRequestOf(form, connection);

      if (Object.keys(request).length === 0) {
        this.nothingChanged.set(true);
        this.submitted = false;

        return;
      }

      this.facade.update(connection.id, request);
    } else {
      this.facade.create(createRequestOf(form));
    }
  }

  copy(text: string | null | undefined): void {
    if (text) void navigator.clipboard?.writeText(text);
  }

  close(): void {
    this.open.set(false);
    // The webhook secret is shown only while the dialog is open.
    this.facade.clearSave();
  }

  onOpenChange(open: boolean): void {
    if (open) this.open.set(true);
    else this.close();
  }

  /** New connections: only the free scopes the caller administers; an edit keeps its scope. */
  private scopeCheck(): readonly string[] | undefined {
    return this.editing() ? undefined : this.scopes();
  }
}
