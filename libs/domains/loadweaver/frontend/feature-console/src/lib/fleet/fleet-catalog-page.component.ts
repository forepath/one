import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  apiErrorMessage,
  FleetCatalogService,
  type FleetCatalogFinding,
  type FleetCatalogInfo,
  type FleetCatalogPackage,
  type FleetCatalogTakedown,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcButtonComponent,
  FpcConfirmDialogComponent,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcFormSwitchComponent,
  FpcListHeaderComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcTableCellDirective,
  FpcTableRowDetailDirective,
  fpcCopyText,
  type FpcBadgeTone,
  type FpcMenuItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import { firstValueFrom, type Observable } from 'rxjs';

import { filterBySearch } from '../list-search';
import { formatBytes } from '../overview/console-format';

/** The state a package version shows: taken down wins over its publication state. */
export type FleetCatalogPackageState = FleetCatalogPackage['status'] | 'taken-down';

export function fleetCatalogPackageState(
  p: Pick<FleetCatalogPackage, 'status' | 'takenDown'>,
): FleetCatalogPackageState {
  return p.takenDown ? 'taken-down' : p.status;
}

export const FLEET_CATALOG_STATE_TONE: Record<FleetCatalogPackageState, FpcBadgeTone> = {
  draft: 'neutral',
  published: 'success',
  unpublished: 'warning',
  'taken-down': 'danger',
};

export function fleetCatalogStateLabel(state: FleetCatalogPackageState): string {
  switch (state) {
    case 'published':
      return $localize`:@@lwConsoleFleetCatalog-statePublished:Published`;
    case 'unpublished':
      return $localize`:@@lwConsoleFleetCatalog-stateUnpublished:Unpublished`;
    case 'taken-down':
      return $localize`:@@lwConsoleFleetCatalog-stateTakenDown:Taken down`;
    default:
      return $localize`:@@lwConsoleFleetCatalog-stateDraft:Draft`;
  }
}

/** The upload's error message plus the lint errors the fleet returned (`findings`). */
export function uploadErrorDetails(error: unknown): { message: string; findings: FleetCatalogFinding[] } {
  const body = error instanceof HttpErrorResponse ? (error.error as Record<string, unknown> | null) : null;
  const findings = Array.isArray(body?.['findings']) ? (body?.['findings'] as FleetCatalogFinding[]) : [];

  return {
    message: apiErrorMessage(error, $localize`:@@lwConsoleFleetCatalog-uploadFailed:The upload failed.`),
    findings: findings.filter((f) => f.severity === 'error' || f.severity === 'warning'),
  };
}

/** `sha256:abcdef…` → `abcdef012345`. */
export function shortDigest(digest: string): string {
  return digest.replace(/^sha256:/, '').slice(0, 12);
}

/**
 * Fleet › Catalog (P1 app store, fleet admins): the fleet's own app catalog. Packages built with `lw app package`
 * are uploaded (validated and linted at the fleet; errors block), signed with the fleet's catalog key, and published
 * into the signed index clusters read as a `type: fleet` catalog; versions can be unpublished, deleted (not
 * published) or taken down (with a reason clusters show). The head copies the catalog URL and the key.
 */
@Component({
  selector: 'loadweaver-fleet-catalog-page',
  imports: [
    CommonModule,
    FormsModule,
    FpcAlertComponent,
    FpcButtonComponent,
    FpcConfirmDialogComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcFormSwitchComponent,
    FpcListHeaderComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcTableCellDirective,
    FpcTableRowDetailDirective,
  ],
  host: { class: 'd-flex flex-column flex-grow-1 min-h-0' },
  templateUrl: './fleet-catalog-page.component.html',
  standalone: true,
})
export class LoadweaverFleetCatalogPageComponent implements OnInit {
  private readonly service = inject(FleetCatalogService);

  readonly info = signal<FleetCatalogInfo | null>(null);
  readonly packages = signal<FleetCatalogPackage[]>([]);
  readonly takedowns = signal<FleetCatalogTakedown[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly notice = signal<{ tone: 'success' | 'danger'; message: string } | null>(null);
  readonly search = signal('');
  readonly expanded = signal<string | null>(null);
  readonly busy = signal<string | null>(null);

  readonly uploadOpen = signal(false);
  readonly uploadFile = signal<File | null>(null);
  readonly uploadChannel = signal('');
  readonly uploadPublish = signal(false);
  readonly uploading = signal(false);
  readonly uploadError = signal<{ message: string; findings: FleetCatalogFinding[] } | null>(null);

  readonly takedownFor = signal<FleetCatalogPackage | null>(null);
  readonly takedownAll = signal(false);
  readonly takedownReason = signal('');
  readonly takedownError = signal<string | null>(null);
  readonly deleteFor = signal<FleetCatalogPackage | null>(null);
  readonly liftFor = signal<FleetCatalogTakedown | null>(null);

  /** The catalog URL clusters use: `FLEET_PUBLIC_URL`, else the fleet URL this console talks to. */
  readonly catalogUrl = computed(
    () => this.info()?.url ?? this.service.consoleFleetUrl(globalThis.location?.origin ?? 'http://localhost'),
  );
  readonly filtered = computed(() =>
    filterBySearch(this.packages(), this.search(), (p) => [
      p.app,
      p.title,
      p.version,
      p.channel,
      fleetCatalogStateLabel(fleetCatalogPackageState(p)),
    ]),
  );

  readonly title = $localize`:@@lwConsoleFleetCatalog-title:Catalog`;
  readonly refreshLabel = $localize`:@@lwConsoleFleetCatalog-refresh:Refresh`;
  readonly uploadLabel = $localize`:@@lwConsoleFleetCatalog-upload:Upload a package`;
  readonly copyUrlLabel = $localize`:@@lwConsoleFleetCatalog-copyUrl:Copy the catalog URL`;
  readonly copyKeyLabel = $localize`:@@lwConsoleFleetCatalog-copyKey:Copy the catalog key`;
  readonly searchLabel = $localize`:@@lwConsoleFleetCatalog-search:Search packages`;
  readonly takedownsTitle = $localize`:@@lwConsoleFleetCatalog-takedowns:Takedowns`;
  readonly takedownTitle = $localize`:@@lwConsoleFleetCatalog-takedownTitle:Take down`;
  readonly deleteTitle = $localize`:@@lwConsoleFleetCatalog-deleteTitle:Delete this version?`;
  readonly deleteMessage = $localize`:@@lwConsoleFleetCatalog-deleteMessage:The uploaded archive is removed from the fleet. Clusters never saw it (it is not published).`;
  readonly deleteLabel = $localize`:@@lwConsoleFleetCatalog-delete:Delete`;
  readonly liftTitle = $localize`:@@lwConsoleFleetCatalog-liftTitle:Lift the takedown?`;
  readonly liftMessage = $localize`:@@lwConsoleFleetCatalog-liftMessage:Clusters show the versions again after their next refresh.`;
  readonly liftLabel = $localize`:@@lwConsoleFleetCatalog-lift:Lift takedown`;
  readonly closeLabel = $localize`:@@lwConsoleFleetCatalog-close:Close`;
  readonly cancelLabel = $localize`:@@lwConsoleFleetCatalog-cancel:Cancel`;

  readonly columns: FpcTableColumn<FleetCatalogPackage>[] = [
    {
      id: 'state',
      label: $localize`:@@lwConsoleFleetCatalog-colState:State`,
      type: 'state',
      state: (p) => {
        const state = fleetCatalogPackageState(p);

        return { label: fleetCatalogStateLabel(state), tone: FLEET_CATALOG_STATE_TONE[state] };
      },
    },
    {
      id: 'app',
      label: $localize`:@@lwConsoleFleetCatalog-colApp:App`,
      value: (p) => p.app,
      required: true,
    },
    {
      id: 'version',
      label: $localize`:@@lwConsoleFleetCatalog-colVersion:Version`,
      value: (p) => p.version,
      mono: true,
      priority: 1,
    },
    {
      id: 'channel',
      label: $localize`:@@lwConsoleFleetCatalog-colChannel:Channel`,
      value: (p) => p.channel,
      priority: 2,
    },
    {
      id: 'digest',
      label: $localize`:@@lwConsoleFleetCatalog-colDigest:Digest`,
      value: (p) => shortDigest(p.digest),
      mono: true,
      priority: 3,
    },
    {
      id: 'size',
      label: $localize`:@@lwConsoleFleetCatalog-colSize:Size`,
      value: (p) => formatBytes(p.size),
      align: 'end',
      priority: 3,
    },
    {
      id: 'findings',
      label: $localize`:@@lwConsoleFleetCatalog-colFindings:Lint warnings`,
      value: (p) => p.findings.filter((f) => f.severity === 'warning').length,
      align: 'end',
      priority: 2,
    },
    {
      id: 'uploaded',
      label: $localize`:@@lwConsoleFleetCatalog-colUploaded:Uploaded`,
      value: (p) => p.createdAt,
      priority: 2,
    },
  ];
  readonly rowId = (p: FleetCatalogPackage): string => p.id;

  readonly takedownColumns: FpcTableColumn<FleetCatalogTakedown>[] = [
    { id: 'app', label: $localize`:@@lwConsoleFleetCatalog-colApp:App`, value: (t) => t.app, required: true },
    {
      id: 'versions',
      label: $localize`:@@lwConsoleFleetCatalog-colVersions:Versions`,
      value: (t) => (t.versions === 'all' ? this.allVersionsLabel : t.versions.join(', ')),
      priority: 1,
    },
    {
      id: 'reason',
      label: $localize`:@@lwConsoleFleetCatalog-colReason:Reason`,
      value: (t) => t.reason,
      priority: 1,
    },
    {
      id: 'at',
      label: $localize`:@@lwConsoleFleetCatalog-colAt:Since`,
      value: (t) => t.createdAt,
      priority: 2,
    },
  ];
  readonly takedownId = (t: FleetCatalogTakedown): string => t.id;
  readonly allVersionsLabel = $localize`:@@lwConsoleFleetCatalog-allVersions:All versions`;

  readonly rowMenu = (p: FleetCatalogPackage): FpcMenuItem[] => [
    ...(p.status === 'published'
      ? [
          {
            id: 'unpublish',
            label: $localize`:@@lwConsoleFleetCatalog-unpublish:Unpublish`,
            icon: 'eye-slash',
            disabled: this.busy() === p.id,
          },
        ]
      : [
          {
            id: 'publish',
            label: $localize`:@@lwConsoleFleetCatalog-publish:Publish`,
            icon: 'cloud-upload',
            disabled: this.busy() === p.id,
          },
        ]),
    {
      id: 'takedown',
      label: $localize`:@@lwConsoleFleetCatalog-takedownAction:Take down…`,
      icon: 'exclamation-octagon',
      danger: true,
    },
    ...(p.status !== 'published'
      ? [{ id: 'delete', label: this.deleteLabel, icon: 'trash', danger: true, disabled: this.busy() === p.id }]
      : []),
    {
      id: 'copy-digest',
      label: $localize`:@@lwConsoleFleetCatalog-copyDigest:Copy digest`,
      icon: 'clipboard',
      dividerBefore: true,
    },
  ];
  readonly takedownMenu = (): FpcMenuItem[] => [{ id: 'lift', label: this.liftLabel, icon: 'arrow-counterclockwise' }];

  readonly stateLabel = (p: FleetCatalogPackage): string => fleetCatalogStateLabel(fleetCatalogPackageState(p));
  readonly formatBytes = formatBytes;

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    this.loading.set(true);
    this.error.set(null);
    this.service.info().subscribe({
      next: (info) => this.info.set(info),
      error: (error: unknown) => this.error.set(apiErrorMessage(error, 'Failed to load the catalog')),
    });
    this.service.takedowns().subscribe({ next: (rows) => this.takedowns.set(rows), error: () => undefined });
    this.service.packages().subscribe({
      next: (rows) => {
        this.packages.set(rows);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.loading.set(false);
        this.error.set(apiErrorMessage(error, 'Failed to load the packages'));
      },
    });
  }

  toggle(p: FleetCatalogPackage): void {
    this.expanded.set(this.expanded() === p.id ? null : p.id);
  }

  copyUrl(): void {
    const url = this.catalogUrl();

    if (url) fpcCopyText(url);
  }

  copyKey(): void {
    const key = this.info()?.publicKey;

    if (key) fpcCopyText(key);
  }

  onRowAction(p: FleetCatalogPackage, action: string): void {
    if (action === 'publish') void this.run(p, this.service.publish(p.app, p.version));
    else if (action === 'unpublish') void this.run(p, this.service.unpublish(p.app, p.version));
    else if (action === 'delete') this.deleteFor.set(p);
    else if (action === 'takedown') this.openTakedown(p);
    else if (action === 'copy-digest') fpcCopyText(p.digest);
  }

  private async run(p: FleetCatalogPackage, call: Observable<unknown>): Promise<void> {
    this.busy.set(p.id);
    this.notice.set(null);

    try {
      await firstValueFrom(call);
      this.refresh();
    } catch (error) {
      this.notice.set({ tone: 'danger', message: apiErrorMessage(error, 'The action failed') });
    } finally {
      this.busy.set(null);
    }
  }

  confirmDelete(): void {
    const p = this.deleteFor();

    this.deleteFor.set(null);

    if (p) void this.run(p, this.service.remove(p.app, p.version));
  }

  // ------------------------------------------------------------------------------------------- upload

  openUpload(): void {
    this.uploadFile.set(null);
    this.uploadChannel.set('');
    this.uploadPublish.set(false);
    this.uploadError.set(null);
    this.uploadOpen.set(true);
  }

  onFiles(files: FileList | null): void {
    this.uploadFile.set(files?.item(0) ?? null);
  }

  async submitUpload(): Promise<void> {
    const file = this.uploadFile();

    if (!file) {
      this.uploadError.set({
        message: $localize`:@@lwConsoleFleetCatalog-chooseFile:Choose the package (.tar.gz built by lw app package).`,
        findings: [],
      });

      return;
    }

    this.uploading.set(true);
    this.uploadError.set(null);

    try {
      const uploaded = await firstValueFrom(
        this.service.upload(file, { channel: this.uploadChannel().trim() || undefined, publish: this.uploadPublish() }),
      );

      this.uploadOpen.set(false);
      this.notice.set({
        tone: 'success',
        message: $localize`:@@lwConsoleFleetCatalog-uploaded:${uploaded.app}:app: ${uploaded.version}:version: uploaded.`,
      });
      this.expanded.set(uploaded.id);
      this.refresh();
    } catch (error) {
      this.uploadError.set(uploadErrorDetails(error));
    } finally {
      this.uploading.set(false);
    }
  }

  // ----------------------------------------------------------------------------------------- takedown

  openTakedown(p: FleetCatalogPackage): void {
    this.takedownAll.set(false);
    this.takedownReason.set('');
    this.takedownError.set(null);
    this.takedownFor.set(p);
  }

  async submitTakedown(): Promise<void> {
    const p = this.takedownFor();
    const reason = this.takedownReason().trim();

    if (!p) return;

    if (!reason) {
      this.takedownError.set($localize`:@@lwConsoleFleetCatalog-reasonRequired:A takedown needs a reason.`);

      return;
    }

    try {
      await firstValueFrom(
        this.service.takedown(p.app, this.takedownAll() ? { reason } : { versions: [p.version], reason }),
      );
      this.takedownFor.set(null);
      this.refresh();
    } catch (error) {
      this.takedownError.set(apiErrorMessage(error, 'The takedown failed'));
    }
  }

  onTakedownAction(t: FleetCatalogTakedown, action: string): void {
    if (action === 'lift') this.liftFor.set(t);
  }

  async confirmLift(): Promise<void> {
    const t = this.liftFor();

    this.liftFor.set(null);

    if (!t) return;

    try {
      await firstValueFrom(this.service.liftTakedown(t.id));
      this.refresh();
    } catch (error) {
      this.notice.set({ tone: 'danger', message: apiErrorMessage(error, 'The action failed') });
    }
  }
}
