import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, OnInit, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  apiErrorMessage,
  ConsoleAccessFacade,
  ConsoleAccessManagementFacade,
  ConsoleEndpointService,
  PlansService,
  SecretsService,
  type SecretSummary,
  type SecretUsage,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcConfirmDialogComponent,
  fpcCopyText,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  type FpcMenuItem,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcTableCellDirective,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import { firstValueFrom, type Observable } from 'rxjs';

import { dlUserLabel } from '../section/data-list';
import { injectSectionScope, sectionQuery } from '../section/section-scope';
import {
  filterSecrets,
  inUseUsages,
  mayManageSecrets,
  mayWriteSecretName,
  RESERVED_SECRET_PREFIX,
  rolloutRefs,
  SECRET_NAME_PATTERN,
  secretId,
  secretProjects,
  secretReference,
  staleUsages,
  usageLabel,
} from './secret-admin-format';

/** The Set value dialog: a new secret (name + project) or a new version of an existing one. */
interface ValueDialog {
  mode: 'create' | 'rotate';
  project: string;
  name: string;
  /** The version a rotation replaces (for the hint). */
  version: number | null;
  usedBy: readonly SecretUsage[];
}

/** After a save: the new version and the resources that still run an older one (Roll out). */
interface SavedNotice {
  secret: SecretSummary;
  stale: SecretUsage[];
}

/**
 * Secrets administration (3.40): the project's secrets (embedded in the project page's Secrets tab, `project` scope) or
 * all secrets the caller may manage (Delivery › Secrets, with a project column). Values are write-only: they are typed
 * (or loaded from a file) into the Set value dialog, sent once and cleared — never shown, stored, put in the URL or kept
 * after the dialog closes. A new version offers **Roll out** (a plan with `refresh` for the resources still pinned to an
 * older one); Delete is refused while resources reference the secret. Works natively and through the fleet (relayed
 * as the signed person; the cluster decides with that person's roles).
 */
@Component({
  selector: 'loadweaver-secret-admin-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcConfirmDialogComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcTableCellDirective,
  ],
  templateUrl: './secret-admin-page.component.html',
  host: { class: 'd-flex flex-column flex-grow-1 min-h-0' },
})
export class LoadweaverSecretAdminPageComponent implements OnInit {
  private readonly service = inject(SecretsService);
  private readonly plans = inject(PlansService);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly accessManagement = inject(ConsoleAccessManagementFacade);
  private readonly endpoints = inject(ConsoleEndpointService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  /** The object scope when embedded in a project's Secrets tab (3.38). */
  readonly scope = injectSectionScope();
  /** The project of the embedding project page; null on the cluster-wide page. */
  readonly project: string | null = sectionQuery(this.route, this.scope).get('project') || null;

  readonly me = toSignal(this.access.me$, { initialValue: null });
  private readonly allProjects = toSignal(this.accessManagement.projects$, { initialValue: [] as string[] });
  readonly fleetMode = this.endpoints.fleetMode;
  readonly allowed = computed(() => mayManageSecrets(this.me(), this.project));
  readonly isClusterAdmin = computed(() => this.me()?.clusterRole === 'cluster-admin');
  /** Fleet mode: secrets are relayed only as the signed person, which needs a cluster that verifies this fleet. */
  readonly fleetBlocked = computed(() => this.fleetMode && !!this.me() && !this.me()?.fleetIdentity);
  readonly nativeUrl = computed(() =>
    this.fleetMode
      ? this.endpoints.nativeConsoleUrl(
          this.project ? `/resources/project/${encodeURIComponent(this.project)}?tab=secrets` : '/delivery/secrets',
        )
      : null,
  );
  readonly writableProjects = computed(() =>
    this.project ? [this.project] : secretProjects(this.me(), this.allProjects()),
  );

  readonly secrets = signal<SecretSummary[]>([]);
  readonly loading = signal(false);
  readonly loaded = signal(false);
  readonly error = signal<string | null>(null);
  readonly query = signal('');
  readonly rows = computed(() => filterSecrets(this.secrets(), this.query()));

  readonly dialog = signal<ValueDialog | null>(null);
  readonly saving = signal(false);
  readonly dialogError = signal<string | null>(null);
  readonly invalidName = signal(false);
  /** The value while the dialog is open (typed or loaded from a file); cleared on close and after sending. */
  value = '';
  readonly fileLabel = signal<string | null>(null);
  readonly saved = signal<SavedNotice | null>(null);
  readonly rollingOut = signal(false);
  readonly rolloutError = signal<string | null>(null);

  readonly deleteFor = signal<SecretSummary | null>(null);
  readonly deleteError = signal<{ message: string; usedBy: SecretUsage[] } | null>(null);

  readonly title = $localize`:@@lwConsoleSecrets-title:Secrets`;
  readonly searchLabel = $localize`:@@lwConsoleSecrets-search:Search secrets`;
  readonly addLabel = $localize`:@@lwConsoleSecrets-add:Add secret`;
  readonly loadingLabel = $localize`:@@lwConsoleSecrets-loading:Loading secrets…`;
  readonly setValueLabel = $localize`:@@lwConsoleSecrets-setValue:Set new value`;
  readonly rolloutLabel = $localize`:@@lwConsoleSecrets-rollout:Roll out`;
  readonly copyRefLabel = $localize`:@@lwConsoleSecrets-copyRef:Copy reference`;
  readonly deleteLabel = $localize`:@@lwConsoleSecrets-delete:Delete`;
  readonly keepLabel = $localize`:@@lwConsoleSecrets-keep:Keep`;
  readonly cancelLabel = $localize`:@@lwConsoleSecrets-cancel:Cancel`;
  readonly inUseTitle = $localize`:@@lwConsoleSecrets-inUseTitle:Still referenced: remove the references first.`;
  readonly reservedTitle = $localize`:@@lwConsoleSecrets-reservedTitle:Platform secret: only cluster admins can change it.`;
  readonly deleteTitle = $localize`:@@lwConsoleSecrets-deleteTitle:Delete the secret?`;
  readonly fleetHint = $localize`:@@lwConsoleSecrets-fleetHint:Secrets go through the fleet only as you, signed: this cluster doesn't verify the fleet's identity yet.`;
  readonly openNativeLabel = $localize`:@@lwConsoleSecrets-openNative:Open in the cluster's console`;
  readonly failedLabel = $localize`:@@lwConsoleSecrets-failed:The secrets couldn't be loaded.`;

  private readonly projectColumn: FpcTableColumn<SecretSummary> = {
    id: 'project',
    label: $localize`:@@lwConsoleSecrets-colProject:Project`,
    value: (s) => s.project,
    priority: 1,
  };
  readonly columns = computed<FpcTableColumn<SecretSummary>[]>(() => [
    {
      id: 'name',
      label: $localize`:@@lwConsoleSecrets-colName:Name`,
      value: (s) => s.name,
      required: true,
      priority: 1,
      mono: true,
    },
    ...(this.project ? [] : [this.projectColumn]),
    {
      id: 'version',
      label: $localize`:@@lwConsoleSecrets-colVersion:Version`,
      value: (s) => s.version,
    },
    {
      id: 'usedBy',
      label: $localize`:@@lwConsoleSecrets-colUsedBy:Used by`,
      value: (s) => s.usedBy.map((u) => usageLabel(u)).join(', '),
    },
    {
      id: 'updated',
      label: $localize`:@@lwConsoleSecrets-colUpdated:Updated`,
      value: (s) => s.updatedAt,
    },
    {
      id: 'updatedBy',
      label: $localize`:@@lwConsoleSecrets-colUpdatedBy:Updated by`,
      value: (s) => dlUserLabel(s.updatedBy),
      hidden: true,
    },
    {
      id: 'created',
      label: $localize`:@@lwConsoleSecrets-colCreated:Created`,
      value: (s) => s.createdAt,
      hidden: true,
    },
  ]);
  readonly rowId = (s: SecretSummary): string => secretId(s);
  readonly rowMenu = (s: SecretSummary): FpcMenuItem[] => {
    const writable = mayWriteSecretName(this.me(), s.name);
    const inUse = s.usedBy.length > 0;

    return [
      {
        id: 'set',
        label: this.setValueLabel,
        icon: 'key',
        disabled: !writable,
        ...(writable ? {} : { title: this.reservedTitle }),
      },
      ...(staleUsages(s).length > 0 ? [{ id: 'rollout', label: this.rolloutLabel, icon: 'arrow-repeat' }] : []),
      { id: 'copy-ref', label: this.copyRefLabel, icon: 'clipboard', dividerBefore: true },
      {
        id: 'delete',
        label: this.deleteLabel,
        icon: 'trash',
        danger: true,
        dividerBefore: true,
        disabled: !writable || inUse,
        ...(!writable ? { title: this.reservedTitle } : inUse ? { title: this.inUseTitle } : {}),
      },
    ];
  };

  readonly staleOf = (s: SecretSummary): SecretUsage[] => staleUsages(s);
  readonly usageText = (u: SecretUsage, current?: number): string => usageLabel(u, current);
  readonly reference = (s: Pick<SecretSummary, 'project' | 'name'>): string => secretReference(s);
  /** Every referencing resource, with the version it runs when older than the current one. */
  readonly usedByTitle = (s: SecretSummary): string => s.usedBy.map((u) => usageLabel(u, s.version)).join('\n');
  readonly reservedPrefix = RESERVED_SECRET_PREFIX;

  constructor() {
    effect(() => {
      if (this.allowed() && !this.fleetBlocked()) untracked(() => this.reload());
    });
    // Cluster admins may add secrets to any project.
    effect(() => {
      if (!this.project && this.isClusterAdmin()) untracked(() => this.accessManagement.loadProjects());
    });
  }

  ngOnInit(): void {
    this.access.load();
  }

  reload(): void {
    const request: Observable<SecretSummary[]> = this.project
      ? this.service.list(this.project)
      : this.service.listAll();

    this.loading.set(true);
    request.subscribe({
      next: (secrets) => {
        this.secrets.set(secrets);
        this.error.set(null);
        this.loading.set(false);
        this.loaded.set(true);
      },
      error: (error: unknown) => {
        this.error.set(apiErrorMessage(error, this.failedLabel));
        this.loading.set(false);
        this.loaded.set(true);
      },
    });
  }

  onRowAction(secret: SecretSummary, action: string): void {
    switch (action) {
      case 'set':
        this.openRotate(secret);
        break;
      case 'rollout':
        void this.rollOut(staleUsages(secret));
        break;
      case 'copy-ref':
        fpcCopyText(secretReference(secret));
        break;
      case 'delete':
        this.deleteError.set(null);
        this.deleteFor.set(secret);
        break;
    }
  }

  openCreate(): void {
    this.openDialog({
      mode: 'create',
      project: this.project ?? this.writableProjects()[0] ?? '',
      name: '',
      version: null,
      usedBy: [],
    });
  }

  openRotate(secret: SecretSummary): void {
    this.openDialog({
      mode: 'rotate',
      project: secret.project,
      name: secret.name,
      version: secret.version,
      usedBy: secret.usedBy,
    });
  }

  private openDialog(dialog: ValueDialog): void {
    this.clearValue();
    this.dialogError.set(null);
    this.invalidName.set(false);
    this.dialog.set(dialog);
  }

  /** Closing the dialog (X, Esc, backdrop, Cancel) forgets the value. */
  onDialogOpenChange(open: boolean): void {
    if (open) return;

    this.clearValue();
    this.dialog.set(null);
  }

  patchDialog(patch: Partial<Pick<ValueDialog, 'project' | 'name'>>): void {
    const dialog = this.dialog();

    if (dialog) this.dialog.set({ ...dialog, ...patch });
  }

  /** A multi-line value (certificate, key) from a file: read into memory only, never shown. */
  async loadFile(files: FileList | null): Promise<void> {
    const file = files?.item(0);

    if (!file) return;

    this.value = await file.text();
    this.fileLabel.set(file.name);
  }

  clearValue(): void {
    this.value = '';
    this.fileLabel.set(null);
  }

  readonly canSave = (): boolean => {
    const dialog = this.dialog();

    return !!dialog && !!dialog.project && !!dialog.name.trim() && this.value.length > 0 && !this.saving();
  };

  async save(): Promise<void> {
    const dialog = this.dialog();

    if (!dialog || !this.canSave()) return;

    const name = dialog.name.trim();

    if (!SECRET_NAME_PATTERN.test(name) || !mayWriteSecretName(this.me(), name)) {
      this.invalidName.set(true);

      return;
    }

    this.invalidName.set(false);
    this.dialogError.set(null);
    this.saving.set(true);

    const value = this.value;

    // The value leaves the component with this one request; the field is cleared whatever the answer.
    this.clearValue();

    try {
      const secret = await firstValueFrom(this.service.setValue(dialog.project, name, value));

      this.dialog.set(null);
      this.saved.set({ secret, stale: staleUsages(secret) });
      this.rolloutError.set(null);
      this.reload();
    } catch (error) {
      this.dialogError.set(
        apiErrorMessage(error, $localize`:@@lwConsoleSecrets-saveFailed:The value couldn't be saved.`),
      );
    } finally {
      this.saving.set(false);
    }
  }

  /** Roll out: a normal plan (preview, approvals, apply) refreshing the resources still on an older version. */
  async rollOut(stale: readonly SecretUsage[]): Promise<void> {
    const refresh = rolloutRefs(stale);

    if (refresh.length === 0 || this.rollingOut()) return;

    this.rollingOut.set(true);
    this.rolloutError.set(null);

    try {
      const plan = await firstValueFrom(this.plans.create({ refresh }));

      this.saved.set(null);
      void this.router.navigate(['/activity/plans', plan.id]);
    } catch (error) {
      this.rolloutError.set(
        apiErrorMessage(error, $localize`:@@lwConsoleSecrets-rolloutFailed:The roll-out plan couldn't be created.`),
      );
    } finally {
      this.rollingOut.set(false);
    }
  }

  onDeleteOpenChange(open: boolean): void {
    if (!open) this.deleteFor.set(null);
  }

  deleteMessage(secret: SecretSummary): string {
    return $localize`:@@lwConsoleSecrets-deleteMessage:${secretReference(secret)}:reference: and all its versions are removed. Resources can no longer reference it.`;
  }

  async confirmDelete(): Promise<void> {
    const secret = this.deleteFor();

    this.deleteFor.set(null);

    if (!secret) return;

    try {
      await firstValueFrom(this.service.delete(secret.project, secret.name));
      this.deleteError.set(null);
      const saved = this.saved();

      if (saved && secretId(saved.secret) === secretId(secret)) this.saved.set(null);
    } catch (error) {
      const usedBy = inUseUsages(error);

      this.deleteError.set({
        message: apiErrorMessage(error, $localize`:@@lwConsoleSecrets-deleteFailed:The secret couldn't be deleted.`),
        usedBy: usedBy ?? [],
      });
    }

    this.reload();
  }
}
