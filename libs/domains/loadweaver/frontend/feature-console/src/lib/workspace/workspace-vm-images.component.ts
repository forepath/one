import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  ConsoleAccessFacade,
  ConsoleVirtualMachinesFacade,
  type VmImageCatalogEntry,
  type VmImageImport,
  type VmRegistryImage,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcEmptyStateComponent,
  FpcFormCheckComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  fpcCopyText,
  FpcDataTableComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcSectionRowComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
  FpcTableCellDirective,
  type FpcMenuItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import { interval } from 'rxjs';

import { formatBytes } from '../overview/console-format';
import { suggestImageRef } from '../virtual-machines/vm-format';
import {
  catalogImportRequest,
  checksumField,
  mayImportVmImages,
  parseImageChecksum,
} from '../virtual-machines/vm-image-catalog';
import { LoadweaverVmImageCatalogComponent } from '../virtual-machines/vm-image-catalog.component';
import { filterBySearch } from '../list-search';
import { dlCopyIdItem } from '../section/data-list';
import { LoadweaverLaneComponent } from '../section/lane.component';

const IMAGE_REF = /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*:[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const REFRESH_MS = 5_000;

/**
 * VM images in the Workspace (3.36): a project's image imports with their progress, the VM images in its registry and
 * the import dialog (URL + SHA-256 / SHA-512 → verified → pushed into the project's registry), moved here from the VM
 * list, and "Import from catalog" (3.42: a recommended, cluster or upstream image, imported as its suggested
 * `repository:tag`). Imports need operator or admin in the project; the relay carries the same routes in fleet mode.
 */
@Component({
  selector: 'loadweaver-workspace-vm-images',
  imports: [
    CommonModule,
    FormsModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcEmptyStateComponent,
    FpcFormCheckComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcDataTableComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcSectionRowComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
    FpcTableCellDirective,
    LoadweaverLaneComponent,
    LoadweaverVmImageCatalogComponent,
  ],
  // Fills the object tab: the lanes scroll (3.38).
  host: { class: 'd-flex flex-column flex-grow-1 min-h-0' },
  templateUrl: './workspace-vm-images.component.html',
  standalone: true,
})
export class LoadweaverWorkspaceVmImagesComponent {
  private readonly facade = inject(ConsoleVirtualMachinesFacade);
  private readonly access = inject(ConsoleAccessFacade);

  /** Show the imports / registry panels (side panel); the dialog works without them. */
  readonly showList = input(false);
  /** Projects to offer (the Workspace's projects). */
  readonly projectNames = input<readonly string[]>([]);
  /** One project only (the Project page's VM images tab): no project select. */
  readonly fixedProject = input<string | null>(null);

  readonly imports = toSignal(this.facade.imports$, { initialValue: [] as VmImageImport[] });
  readonly importsLoading = toSignal(this.facade.importsLoading$, { initialValue: false });
  readonly importsError = toSignal(this.facade.importsError$, { initialValue: null });
  readonly importing = toSignal(this.facade.importing$, { initialValue: false });
  readonly importError = toSignal(this.facade.importError$, { initialValue: null });
  readonly registryImages = toSignal(this.facade.registryImages$, { initialValue: [] as VmRegistryImage[] });
  readonly registryImagesLoading = toSignal(this.facade.registryImagesLoading$, { initialValue: false });
  readonly registryImagesError = toSignal(this.facade.registryImagesError$, { initialValue: null });
  private readonly memberProjects = toSignal(this.access.projects$, { initialValue: [] as string[] });
  private readonly me = toSignal(this.access.me$, { initialValue: null });

  readonly project = signal('');
  readonly projects = computed(() => {
    const fixed = this.fixedProject();

    return fixed ? [fixed] : [...new Set([...this.projectNames(), ...this.memberProjects()])].sort();
  });
  /** Projects where the caller may import images (operators and admins). */
  readonly importProjects = computed(() => {
    const me = this.me();

    return this.projects().filter((p) => mayImportVmImages(me, p));
  });

  readonly importOpen = signal(false);
  importProject = '';
  importUrl = '';
  importSha256 = '';
  importRef = '';
  importArch: 'amd64' | 'arm64' = 'amd64';
  importUefi = true;
  importBios = false;
  importGuestAgent = false;
  readonly importInvalid = signal(false);
  private submitted = false;

  /** "Import from catalog" (3.42): the picked entry, imported as `catalogRef` (its suggested reference, editable). */
  readonly catalogOpen = signal(false);
  catalogProject = '';
  catalogRef = '';
  readonly catalogEntry = signal<VmImageCatalogEntry | null>(null);
  readonly catalogInvalid = signal(false);
  /** `repository:tag`s of the shown project (the picker marks them "In project"). */
  readonly presentRefs = computed(() => this.registryImages().map((i) => `${i.repository}:${i.tag}`));

  readonly bytes = formatBytes;
  readonly imagesTitle = $localize`:@@lwConsoleWorkspace-vmImages:VM images`;
  readonly imagesSearchLabel = $localize`:@@lwConsoleVmImages-search:Search images`;
  readonly importsSearchLabel = $localize`:@@lwConsoleVmImages-searchImports:Search imports`;
  readonly loadingLabel = $localize`:@@lwConsoleVmImages-loading:Loading`;
  readonly pickProjectLabel = $localize`:@@lwConsoleVmImages-pickProject:Pick a project`;
  readonly guestAgentLabel = $localize`:@@lwConsoleVms-guestAgent:guest agent`;
  /** 3.38 D1: image · variants · guest agent · virtual size · firmware (no digest, D11). */
  readonly imageColumns: FpcTableColumn<VmRegistryImage>[] = [
    {
      id: 'image',
      label: $localize`:@@lwConsoleVmImages-colImage:Image`,
      value: (i) => `${i.repository}:${i.tag}`,
      required: true,
      priority: 1,
      mono: true,
    },
    { id: 'variants', label: $localize`:@@lwConsoleVmImages-colVariants:Variants`, priority: 1 },
    { id: 'guestAgent', label: this.guestAgentLabel, width: '4rem', align: 'center' },
    {
      id: 'size',
      label: $localize`:@@lwConsoleVms-virtualSize:Virtual size`,
      value: (i) => (i.variants[0] ? formatBytes(i.variants[0].virtualSize) : ''),
      align: 'end',
    },
    {
      id: 'firmware',
      label: $localize`:@@lwConsoleVmImages-colFirmware:Firmware`,
      value: (i) => firmwareLabel(i.variants[0]?.firmware ?? []),
      priority: 3,
    },
  ];
  readonly imageId = (i: VmRegistryImage) => i.reference;
  readonly imageMenu = (): FpcMenuItem[] => [
    { id: 'copy-reference', label: $localize`:@@lwConsoleVmImages-copyReference:Copy reference`, icon: 'clipboard' },
  ];
  /** 3.38 D1: State · image · step · arch · firmware · downloaded · virtual size · source URL · time · error. */
  readonly importColumns: FpcTableColumn<VmImageImport>[] = [
    {
      id: 'status',
      label: $localize`:@@lwConsoleVmImages-colStatus:Status`,
      type: 'state',
      state: (i) => ({ label: this.importStatusLabel(i.status), tone: this.importTone(i.status) }),
    },
    {
      id: 'reference',
      label: $localize`:@@lwConsoleVmImages-colImage:Image`,
      value: (i) => i.reference,
      required: true,
      priority: 1,
    },
    {
      id: 'step',
      label: $localize`:@@lwConsoleVmImages-colStep:Step`,
      value: (i) => (i.step ? vmImportStepLabel(i.step) : ''),
      priority: 1,
    },
    {
      id: 'format',
      label: $localize`:@@lwConsoleVmImages-colFormat:Format`,
      value: (i) => i.format ?? '',
      priority: 3,
    },
    { id: 'arch', label: $localize`:@@lwConsoleVmImages-colArch:Architecture`, value: (i) => i.arch },
    {
      id: 'firmware',
      label: $localize`:@@lwConsoleVmImages-colFirmware:Firmware`,
      value: (i) => firmwareLabel(i.firmware),
      priority: 3,
    },
    {
      id: 'downloaded',
      label: $localize`:@@lwConsoleVmImages-colDownloaded:Downloaded`,
      value: (i) => (i.downloadedBytes > 0 ? formatBytes(i.downloadedBytes) : ''),
      align: 'end',
      priority: 3,
    },
    {
      id: 'size',
      label: $localize`:@@lwConsoleVms-virtualSize:Virtual size`,
      value: (i) => (i.virtualSize ? formatBytes(i.virtualSize) : ''),
      align: 'end',
      priority: 3,
    },
    { id: 'url', label: $localize`:@@lwConsoleVmImages-colUrl:Source`, value: (i) => i.url, hidden: true },
    {
      id: 'created',
      label: $localize`:@@lwConsoleVmImages-colCreated:Started`,
      value: (i) => i.createdAt,
    },
    { id: 'error', label: $localize`:@@lwConsoleVmImages-colError:Error`, value: (i) => i.error ?? '' },
  ];
  readonly importMenu = (): FpcMenuItem[] => [dlCopyIdItem()];
  /** Phones: Images | Imports, one lane at a time. */
  readonly lane = signal<'images' | 'imports'>('images');
  readonly imagesSearch = signal('');
  readonly importsSearch = signal('');
  readonly visibleImages = computed(() =>
    filterBySearch(this.registryImages(), this.imagesSearch(), (i) => [
      i.repository,
      i.tag,
      i.variants.map((v) => v.arch),
    ]),
  );
  readonly visibleImports = computed(() =>
    filterBySearch(this.imports(), this.importsSearch(), (i) => [
      i.reference,
      i.url,
      this.importStatusLabel(i.status),
      i.arch,
      i.format,
    ]),
  );
  readonly importLabel = $localize`:@@lwConsoleVms-importImage:Import VM image`;
  readonly projectFilterLabel = $localize`:@@lwConsoleVms-projectFilter:Project`;
  readonly importsTitle = $localize`:@@lwConsoleVms-importsTitle:VM image imports`;
  readonly importTitle = $localize`:@@lwConsoleVms-importTitle:Import a VM image`;
  readonly catalogLabel = $localize`:@@lwConsoleVmCatalog-import:Import from catalog`;
  readonly registryTitle = $localize`:@@lwConsoleVms-registryTitle:VM images in the registry`;

  constructor() {
    // The first project once known; then the imports and registry images of the chosen project.
    effect(() => {
      if (!this.project() && this.projects().length) untracked(() => this.project.set(this.projects()[0]));
    });
    effect(() => {
      const project = this.project();

      if (project && this.showList())
        untracked(() => {
          this.facade.loadImports(project);
          this.facade.loadRegistryImages(project);
        });
    });
    // A queued import closes the dialog and shows its project.
    effect(() => {
      const importing = this.importing();
      const error = this.importError();

      untracked(() => {
        if (this.submitted && !importing && !error) {
          this.submitted = false;
          this.project.set(this.catalogOpen() ? this.catalogProject : this.importProject);
          this.importOpen.set(false);
          this.catalogOpen.set(false);
        } else if (!importing) {
          this.submitted = false;
        }
      });
    });
    // Running imports refresh their progress.
    interval(REFRESH_MS)
      .pipe(takeUntilDestroyed(inject(DestroyRef)))
      .subscribe(() => {
        if (this.project() && this.imports().some((i) => i.status === 'pending' || i.status === 'running'))
          this.facade.loadImports(this.project());
      });
  }

  copy(text: string): void {
    fpcCopyText(text);
  }

  hasGuestAgent(image: VmRegistryImage): boolean {
    return image.variants.some((v) => v.guestAgent);
  }

  openImport(project: string | null = null): void {
    this.facade.clearImportError();
    this.importProject = project ?? (this.project() || this.importProjects()[0] || '');
    this.importUrl = '';
    this.importSha256 = '';
    this.importRef = '';
    this.importArch = 'amd64';
    this.importUefi = true;
    this.importBios = false;
    this.importGuestAgent = false;
    this.importInvalid.set(false);
    this.importOpen.set(true);
  }

  onImportOpenChange(open: boolean): void {
    this.importOpen.set(open);
  }

  onImportUrlChange(url: string): void {
    this.importUrl = url;

    if (!this.importRef) this.importRef = suggestImageRef(url);
  }

  submitImport(): void {
    const checksum = parseImageChecksum(this.importSha256);
    const firmware = [...(this.importUefi ? (['uefi'] as const) : []), ...(this.importBios ? (['bios'] as const) : [])];
    const valid =
      !!this.importProject &&
      /^https:\/\/\S+$/.test(this.importUrl.trim()) &&
      !!checksum &&
      IMAGE_REF.test(this.importRef.trim()) &&
      firmware.length > 0 &&
      !(this.importArch === 'arm64' && this.importBios);

    this.importInvalid.set(!valid);

    if (!valid || !checksum) return;

    this.submitted = true;
    this.facade.importImage(this.importProject, {
      url: this.importUrl.trim(),
      ...checksumField(checksum),
      ref: this.importRef.trim(),
      arch: this.importArch,
      firmware: [...firmware],
      guestAgent: this.importGuestAgent,
    });
  }

  openCatalog(): void {
    this.facade.clearImportError();
    this.catalogProject = this.importProjects().includes(this.project())
      ? this.project()
      : (this.importProjects()[0] ?? '');
    this.catalogRef = '';
    this.catalogEntry.set(null);
    this.catalogInvalid.set(false);
    this.catalogOpen.set(true);
  }

  onCatalogOpenChange(open: boolean): void {
    this.catalogOpen.set(open);
  }

  /** A picked entry prefills the reference with its suggestion (the user may change it before importing). */
  pickCatalogEntry(entry: VmImageCatalogEntry): void {
    this.catalogEntry.set(entry);
    this.catalogRef = entry.suggestedRef;
    this.catalogInvalid.set(false);
  }

  submitCatalogImport(): void {
    const entry = this.catalogEntry();
    const valid = !!entry && !!this.catalogProject && IMAGE_REF.test(this.catalogRef.trim());

    this.catalogInvalid.set(!valid);

    if (!valid || !entry) return;

    this.submitted = true;
    this.facade.importImage(this.catalogProject, catalogImportRequest(entry, this.catalogRef));
  }

  /** Import state as a tone badge (3.38 R10). */
  importTone(status: VmImageImport['status']): 'success' | 'danger' | 'info' | 'neutral' {
    return status === 'succeeded'
      ? 'success'
      : status === 'failed'
        ? 'danger'
        : status === 'running'
          ? 'info'
          : 'neutral';
  }

  importStatusLabel(status: VmImageImport['status']): string {
    switch (status) {
      case 'succeeded':
        return $localize`:@@lwConsoleVmImages-statusSucceeded:Imported`;
      case 'failed':
        return $localize`:@@lwConsoleVmImages-statusFailed:Failed`;
      case 'running':
        return $localize`:@@lwConsoleVmImages-statusRunning:Importing`;
      default:
        return $localize`:@@lwConsoleVmImages-statusPending:Pending`;
    }
  }
}

/** Firmware list, readable (`UEFI, BIOS`). */
function firmwareLabel(firmware: readonly string[]): string {
  return firmware.map((f) => f.toUpperCase()).join(', ');
}

/** An image import's step, readable (3.38 D9; unknown steps as they are). */
export function vmImportStepLabel(step: string): string {
  switch (step) {
    case 'download':
      return $localize`:@@lwConsoleVmImages-stepDownload:Downloading`;
    case 'verify':
      return $localize`:@@lwConsoleVmImages-stepVerify:Verifying`;
    case 'convert':
      return $localize`:@@lwConsoleVmImages-stepConvert:Converting`;
    case 'push':
      return $localize`:@@lwConsoleVmImages-stepPush:Pushing to the registry`;
    default:
      return step;
  }
}
