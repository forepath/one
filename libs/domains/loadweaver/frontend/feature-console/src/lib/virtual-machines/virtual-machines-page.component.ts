import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, OnInit, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleVirtualMachinesFacade,
  type VirtualMachineSummary,
  type VmImageImport,
  type VmRegistryImage,
  type VmPhase,
  type VmRunStrategy,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcCollapsibleFilterPanelComponent,
  FpcEmptyStateComponent,
  FpcFormCheckComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcListComponent,
  FpcListItemComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcPanelComponent,
  FpcPanelGridComponent,
  FpcSearchFieldComponent,
  FpcSpinnerComponent,
  FpcStatusBadgeComponent,
} from '@forepath/shared/frontend/ui-components';
import { interval } from 'rxjs';

import { formatBytes } from '../overview/console-format';
import {
  matchesVmSearch,
  phaseIcon,
  phaseLabel,
  phaseTone,
  runStrategyLabel,
  suggestImageRef,
  VM_PHASES,
  VM_RUN_STRATEGIES,
  vmLink,
} from './vm-format';
import { LoadweaverVmImportProgressComponent } from './vm-import-progress.component';

const REFRESH_MS = 15_000;
const SHA256 = /^(?:sha256:)?[0-9a-fA-F]{64}$/;
const IMAGE_REF = /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*:[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/**
 * Virtual machines (3.35): every VM the caller may read with phase, node, sizing and addresses, filtered by project,
 * phase and run strategy. New VMs and changes go through the resource editor (YAML → plan); VM images are imported
 * here (download → verify → push into the project's registry).
 */
@Component({
  selector: 'loadweaver-virtual-machines-page',
  imports: [
    LoadweaverVmImportProgressComponent,
    CommonModule,
    FormsModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcCollapsibleFilterPanelComponent,
    FpcEmptyStateComponent,
    FpcFormCheckComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcListComponent,
    FpcListItemComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcPanelComponent,
    FpcPanelGridComponent,
    FpcSearchFieldComponent,
    FpcSpinnerComponent,
    FpcStatusBadgeComponent,
  ],
  templateUrl: './virtual-machines-page.component.html',
  standalone: true,
})
export class LoadweaverVirtualMachinesPageComponent implements OnInit {
  private readonly facade = inject(ConsoleVirtualMachinesFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly vms = toSignal(this.facade.vms$, { initialValue: [] as VirtualMachineSummary[] });
  readonly loading = toSignal(this.facade.loading$, { initialValue: false });
  readonly error = toSignal(this.facade.error$, { initialValue: null });
  readonly imports = toSignal(this.facade.imports$, { initialValue: [] as VmImageImport[] });
  readonly importsLoading = toSignal(this.facade.importsLoading$, { initialValue: false });
  readonly importsError = toSignal(this.facade.importsError$, { initialValue: null });
  readonly importing = toSignal(this.facade.importing$, { initialValue: false });
  readonly importError = toSignal(this.facade.importError$, { initialValue: null });
  readonly registryImages = toSignal(this.facade.registryImages$, { initialValue: [] as VmRegistryImage[] });
  readonly registryImagesLoading = toSignal(this.facade.registryImagesLoading$, { initialValue: false });
  readonly registryImagesError = toSignal(this.facade.registryImagesError$, { initialValue: null });
  private readonly vmProjects = toSignal(this.facade.projects$, { initialValue: [] as string[] });
  private readonly memberProjects = toSignal(this.access.projects$, { initialValue: [] as string[] });
  private readonly me = toSignal(this.access.me$, { initialValue: null });

  readonly search = signal('');
  readonly project = signal('');
  readonly phase = signal<VmPhase | ''>('');
  readonly strategy = signal<VmRunStrategy | ''>('');
  readonly filtersOpen = signal(false);
  readonly activeFilterCount = computed(
    () => (this.project() ? 1 : 0) + (this.phase() ? 1 : 0) + (this.strategy() ? 1 : 0),
  );

  readonly projects = computed(() => [...new Set([...this.vmProjects(), ...this.memberProjects()])].sort());
  readonly filtered = computed(() => {
    const project = this.project();
    const phase = this.phase();
    const strategy = this.strategy();
    const search = this.search();

    return this.vms()
      .filter(
        (vm) =>
          (!project || vm.project === project) &&
          (!phase || vm.phase === phase) &&
          (!strategy || vm.runStrategy === strategy) &&
          matchesVmSearch(vm, search),
      )
      .sort((a, b) => a.project.localeCompare(b.project) || a.name.localeCompare(b.name));
  });
  readonly running = computed(() => this.filtered().filter((vm) => vm.phase === 'Running').length);
  /** Projects where the caller may import images (operators and admins). */
  readonly importProjects = computed(() => {
    const me = this.me();

    if (me?.clusterRole === 'cluster-admin') return this.projects();

    return this.projects().filter((p) => me?.projects?.[p] === 'operator' || me?.projects?.[p] === 'admin');
  });

  // Import modal.
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

  readonly phases = VM_PHASES;
  readonly strategies = VM_RUN_STRATEGIES;
  readonly phaseTone = phaseTone;
  readonly phaseIcon = phaseIcon;
  readonly phaseLabel = phaseLabel;
  readonly strategyLabel = runStrategyLabel;
  readonly bytes = formatBytes;

  readonly title = $localize`:@@lwConsoleVms-title:Virtual machines`;
  readonly refreshLabel = $localize`:@@lwConsoleVms-refresh:Refresh`;
  readonly newLabel = $localize`:@@lwConsoleVms-new:New virtual machine`;
  readonly importLabel = $localize`:@@lwConsoleVms-importImage:Import VM image`;
  readonly searchLabel = $localize`:@@lwConsoleVms-search:Search virtual machines`;
  readonly filtersLabel = $localize`:@@lwConsoleVms-filters:Filters`;
  readonly projectFilterLabel = $localize`:@@lwConsoleVms-projectFilter:Project`;
  readonly phaseFilterLabel = $localize`:@@lwConsoleVms-phaseFilter:Phase`;
  readonly strategyFilterLabel = $localize`:@@lwConsoleVms-strategyFilter:Run strategy`;
  readonly vmsTitle = $localize`:@@lwConsoleVms-listTitle:Virtual machines`;
  readonly importsTitle = $localize`:@@lwConsoleVms-importsTitle:VM image imports`;
  readonly importTitle = $localize`:@@lwConsoleVms-importTitle:Import a VM image`;
  readonly registryTitle = $localize`:@@lwConsoleVms-registryTitle:VM images in the registry`;

  constructor() {
    // The imports of the filtered project (VM images live in a project's registry namespace).
    effect(() => {
      const project = this.project();

      if (project)
        untracked(() => {
          this.facade.loadImports(project);
          this.facade.loadRegistryImages(project);
        });
    });
    // A queued import closes the modal.
    effect(() => {
      const importing = this.importing();
      const error = this.importError();

      untracked(() => {
        if (this.submitted && !importing && !error) {
          this.submitted = false;
          this.importOpen.set(false);
          this.project.set(this.importProject);
        } else if (!importing) {
          this.submitted = false;
        }
      });
    });
  }

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;

    this.project.set(params.get('project') ?? '');
    this.facade.load();
    interval(REFRESH_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.facade.load(true);

        if (this.project() && this.imports().some((i) => i.status === 'pending' || i.status === 'running'))
          this.facade.loadImports(this.project());
      });
  }

  refresh(): void {
    this.facade.load();

    if (this.project()) {
      this.facade.loadImports(this.project());
      this.facade.loadRegistryImages(this.project());
    }
  }

  hasGuestAgent(image: VmRegistryImage): boolean {
    return image.variants.some((v) => v.guestAgent);
  }

  clearFilters(): void {
    this.project.set('');
    this.phase.set('');
    this.strategy.set('');
  }

  open(vm: VirtualMachineSummary): void {
    void this.router.navigate(vmLink(vm));
  }

  /** A new VM goes through the resource editor (YAML → plan). */
  create(): void {
    const project = this.project();

    void this.router.navigate(['/resources', 'new'], {
      queryParams: { kind: 'VirtualMachine', ...(project ? { project } : {}) },
    });
  }

  openImport(): void {
    this.facade.clearImportError();
    this.importProject = this.project() || this.importProjects()[0] || '';
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
    const firmware = [...(this.importUefi ? (['uefi'] as const) : []), ...(this.importBios ? (['bios'] as const) : [])];
    const valid =
      !!this.importProject &&
      /^https:\/\/\S+$/.test(this.importUrl.trim()) &&
      SHA256.test(this.importSha256.trim()) &&
      IMAGE_REF.test(this.importRef.trim()) &&
      firmware.length > 0 &&
      !(this.importArch === 'arm64' && this.importBios);

    this.importInvalid.set(!valid);

    if (!valid) return;

    this.submitted = true;
    this.facade.importImage(this.importProject, {
      url: this.importUrl.trim(),
      sha256: this.importSha256.trim().toLowerCase(),
      ref: this.importRef.trim(),
      arch: this.importArch,
      firmware: [...firmware],
      guestAgent: this.importGuestAgent,
    });
  }

  importTone(status: VmImageImport['status']): 'success' | 'danger' | 'info' | 'secondary' {
    return status === 'succeeded'
      ? 'success'
      : status === 'failed'
        ? 'danger'
        : status === 'running'
          ? 'info'
          : 'secondary';
  }

  importIcon(status: VmImageImport['status']): string {
    return status === 'succeeded'
      ? 'bi-check-lg'
      : status === 'failed'
        ? 'bi-x-lg'
        : status === 'running'
          ? 'bi-arrow-repeat'
          : 'bi-hourglass-split';
  }
}
