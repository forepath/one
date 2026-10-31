import { Component, computed, DestroyRef, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  apiErrorMessage,
  type VmImageCatalogEntry,
  VirtualMachinesService,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcTableCellDirective,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';

import { catalogDistros, catalogRows, distroName, type VmImageArch } from './vm-image-catalog';

/**
 * VM image catalog picker (3.42), used by the project's Images tab ("Import from catalog") and the VirtualMachine
 * wizard's image step ("Recommended images"): Recommended (shipped with the release) first, the cluster's own entries
 * marked, filtered by distro and architecture (amd64 by default). "Show other versions" reads the distros' current
 * builds on demand (the live lookup may be slow or partial: its warnings are shown). Emits the picked entry.
 */
@Component({
  selector: 'loadweaver-vm-image-catalog',
  standalone: true,
  imports: [
    FormsModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcTableCellDirective,
  ],
  templateUrl: './vm-image-catalog.component.html',
})
export class LoadweaverVmImageCatalogComponent {
  private readonly api = inject(VirtualMachinesService);
  private readonly destroyRef = inject(DestroyRef);

  /** `repository:tag`s the project already has (marked "In project"). */
  readonly present = input<readonly string[]>([]);
  /** The picked entry's id (the table's selection). */
  readonly selectedId = input<string | null>(null);
  /** Prefix of the filter control ids (several pickers on a page). */
  readonly idPrefix = input('lw-vm-catalog');

  readonly picked = output<VmImageCatalogEntry>();

  readonly entries = signal<VmImageCatalogEntry[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly upstream = signal<VmImageCatalogEntry[]>([]);
  readonly upstreamWarnings = signal<string[]>([]);
  readonly upstreamLoading = signal(false);
  readonly upstreamError = signal<string | null>(null);
  /** "Show other versions" was used (the upstream lookup is requested once). */
  readonly showOther = signal(false);

  readonly arch = signal<VmImageArch>('amd64');
  readonly distro = signal('');
  readonly query = signal('');

  readonly all = computed(() => [...this.entries(), ...this.upstream()]);
  readonly distros = computed(() => catalogDistros(this.all()));
  readonly rows = computed(() => {
    const query = this.query().trim().toLowerCase();

    return catalogRows(this.all(), { arch: this.arch(), distro: this.distro() || null }).filter(
      (e) =>
        !query ||
        [e.label, e.version, e.distro, e.suggestedRef, e.description ?? '', e.build ?? ''].some((t) =>
          t.toLowerCase().includes(query),
        ),
    );
  });
  readonly selection = computed<readonly string[]>(() => {
    const id = this.selectedId();

    return id ? [id] : [];
  });

  readonly distroName = distroName;
  readonly rowId = (e: VmImageCatalogEntry) => e.id;
  readonly groupOf = (e: VmImageCatalogEntry) => e.source;
  readonly groupLabel = (source: string) =>
    source === 'shipped' ? this.recommendedLabel : source === 'cluster' ? this.clusterLabel : this.otherLabel;
  readonly title = $localize`:@@lwConsoleVmCatalog-title:VM image catalog`;
  readonly searchLabel = $localize`:@@lwConsoleVmCatalog-search:Search the catalog`;
  readonly distroLabel = $localize`:@@lwConsoleVmCatalog-distro:Distribution`;
  readonly allDistrosLabel = $localize`:@@lwConsoleVmCatalog-allDistros:All distributions`;
  readonly archLabel = $localize`:@@lwConsoleVmImages-colArch:Architecture`;
  readonly recommendedLabel = $localize`:@@lwConsoleVmCatalog-recommended:Recommended`;
  readonly clusterLabel = $localize`:@@lwConsoleVmCatalog-cluster:This cluster's images`;
  readonly clusterBadge = $localize`:@@lwConsoleVmCatalog-clusterBadge:Cluster`;
  readonly otherLabel = $localize`:@@lwConsoleVmCatalog-other:Other versions`;
  readonly presentLabel = $localize`:@@lwConsoleVmCatalog-present:In project`;
  readonly guestAgentLabel = $localize`:@@lwConsoleVms-guestAgent:guest agent`;
  readonly columns: FpcTableColumn<VmImageCatalogEntry>[] = [
    {
      id: 'image',
      label: $localize`:@@lwConsoleVmImages-colImage:Image`,
      value: (e) => e.label,
      required: true,
      priority: 1,
    },
    { id: 'version', label: $localize`:@@lwConsoleVmCatalog-colVersion:Version`, value: (e) => e.version },
    {
      id: 'ref',
      label: $localize`:@@lwConsoleVmCatalog-colRef:Imported as`,
      value: (e) => e.suggestedRef,
      mono: true,
      priority: 3,
    },
    {
      id: 'firmware',
      label: $localize`:@@lwConsoleVmImages-colFirmware:Firmware`,
      value: (e) => (e.firmware ?? []).map((f) => f.toUpperCase()).join(', '),
      priority: 3,
    },
    { id: 'guestAgent', label: this.guestAgentLabel, width: '4rem', align: 'center' },
  ];

  constructor() {
    this.api
      .catalog()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (catalog) => {
          this.entries.set(catalog.entries ?? []);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.error.set(apiErrorMessage(error, 'Failed to load the VM image catalog'));
          this.loading.set(false);
        },
      });
  }

  /** Reads the distros' current builds (once). */
  showOtherVersions(): void {
    if (this.showOther()) return;

    this.showOther.set(true);
    this.upstreamLoading.set(true);
    this.api
      .upstreamCatalog()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.upstream.set(result.entries ?? []);
          this.upstreamWarnings.set(result.warnings ?? []);
          this.upstreamLoading.set(false);
        },
        error: (error: unknown) => {
          this.upstreamError.set(apiErrorMessage(error, 'Failed to read the other versions'));
          this.upstreamLoading.set(false);
        },
      });
  }

  isPresent(entry: VmImageCatalogEntry): boolean {
    return this.present().includes(entry.suggestedRef);
  }

  onSelection(ids: readonly string[]): void {
    const entry = this.all().find((e) => e.id === ids[0]);

    if (entry) this.picked.emit(entry);
  }
}
