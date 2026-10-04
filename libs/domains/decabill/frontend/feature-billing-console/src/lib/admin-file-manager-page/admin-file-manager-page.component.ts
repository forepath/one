import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  AdminFileManagerFacade,
  BillingCapabilitiesFacade,
  buildAdminFileManagerCacheKey,
  type AdminFileManagerEntry,
  type AdminFileManagerView,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { ENVIRONMENT, type Environment } from '@forepath/decabill/frontend/util-configuration';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcButtonGroupComponent,
  FpcEmptyStateComponent,
  FpcPageHeaderComponent,
  FpcSpinnerComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
  FpcTooltipComponent,
} from '@forepath/shared/frontend/ui-components';
import { combineLatest, map } from 'rxjs';

interface TreeNodeView {
  entry: AdminFileManagerEntry;
  depth: number;
}

@Component({
  selector: 'framework-admin-file-manager-page',
  standalone: true,
  imports: [
    CommonModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcButtonGroupComponent,
    FpcEmptyStateComponent,
    FpcPageHeaderComponent,
    FpcSpinnerComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
    FpcTooltipComponent,
  ],
  templateUrl: './admin-file-manager-page.component.html',
  styleUrl: './admin-file-manager-page.component.scss',
})
export class AdminFileManagerPageComponent implements OnInit {
  private readonly facade = inject(AdminFileManagerFacade);
  private readonly capabilitiesFacade = inject(BillingCapabilitiesFacade);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  readonly homeTenantId = this.environment.billing?.tenantId?.trim() || 'default';
  readonly pageTitle = $localize`:@@featureAdminFileExplorer-title:File Explorer`;
  readonly unifiedTabLabel = $localize`:@@featureAdminFileExplorer-tabUnified:Unified`;
  readonly refreshAriaLabel = $localize`:@@featureAdminFileExplorer-refresh:Refresh`;
  readonly downloadAriaLabel = $localize`:@@featureAdminFileExplorer-download:Download`;

  readonly selectedPath = signal<string | null>(null);
  readonly selectedType = signal<'file' | 'directory' | null>(null);

  readonly view$ = this.facade.view$;
  readonly viewTenantId$ = this.facade.viewTenantId$;
  readonly error$ = this.facade.error$;
  readonly downloadLoading$ = this.facade.downloadLoading$;
  readonly loadingPath$ = this.facade.loadingPath$;
  readonly globalViewsAllowed$ = this.capabilitiesFacade.globalViewsAllowed$;
  readonly viewableTenants$ = this.capabilitiesFacade.viewableTenants$;

  readonly showViewTabs$ = this.globalViewsAllowed$;

  readonly activeTabId$ = combineLatest([this.view$, this.viewTenantId$]).pipe(
    map(([view, viewTenantId]) => (view === 'unified' ? 'unified' : (viewTenantId ?? this.homeTenantId))),
  );

  readonly state = toSignal(this.facade.state$, { initialValue: null });
  readonly viewableTenants = toSignal(this.viewableTenants$, { initialValue: [] as string[] });

  readonly treeNodes = computed(() => {
    const state = this.state();

    if (!state) {
      return [] as TreeNodeView[];
    }

    const expanded = new Set(state.expandedPaths);
    const nodes: TreeNodeView[] = [];

    const walk = (path: string, depth: number): void => {
      const cacheKey = buildAdminFileManagerCacheKey(state.view, state.viewTenantId, path);
      const entries = state.directoriesByPath[cacheKey] ?? [];

      for (const entry of entries) {
        nodes.push({ entry, depth });

        if (entry.type === 'directory' && expanded.has(entry.path)) {
          walk(entry.path, depth + 1);
        }
      }
    };

    walk('', 0);

    return nodes;
  });

  ngOnInit(): void {
    this.capabilitiesFacade.loadCapabilities();
    this.facade.setView('tenant', this.homeTenantId);
    this.facade.listDirectory({ path: '', view: 'tenant', viewTenantId: this.homeTenantId });
  }

  tenantTabLabel(tenantId: string): string {
    if (!tenantId) {
      return tenantId;
    }

    return tenantId.charAt(0).toUpperCase() + tenantId.slice(1);
  }

  onTabChange(tabId: string | null): void {
    if (!tabId) {
      return;
    }

    if (tabId === 'unified') {
      this.facade.setView('unified');
      this.selectedPath.set(null);
      this.selectedType.set(null);
      this.facade.listDirectory({ path: '', view: 'unified' });

      return;
    }

    this.facade.setView('tenant', tabId);
    this.selectedPath.set(null);
    this.selectedType.set(null);
    this.facade.listDirectory({ path: '', view: 'tenant', viewTenantId: tabId });
  }

  onNodeActivate(entry: AdminFileManagerEntry): void {
    this.selectedPath.set(entry.path);
    this.selectedType.set(entry.type);

    if (entry.type !== 'directory') {
      return;
    }

    const state = this.state();
    const expanded = new Set(state?.expandedPaths ?? ['']);

    if (expanded.has(entry.path)) {
      this.facade.collapsePath(entry.path);

      return;
    }

    this.facade.expandPath(entry.path);

    const view = (state?.view ?? 'tenant') as AdminFileManagerView;
    const viewTenantId = state?.viewTenantId ?? this.homeTenantId;
    const cacheKey = buildAdminFileManagerCacheKey(view, view === 'unified' ? null : viewTenantId, entry.path);
    const cached = !!state?.directoriesByPath[cacheKey];

    this.facade.ensureDirectoryLoaded(
      {
        path: entry.path,
        view,
        viewTenantId: view === 'unified' ? undefined : viewTenantId,
      },
      cached,
    );
  }

  isExpanded(path: string): boolean {
    return (this.state()?.expandedPaths ?? ['']).includes(path);
  }

  isSelected(path: string): boolean {
    return this.selectedPath() === path;
  }

  contentHashesTooltip(entry: AdminFileManagerEntry): string {
    const hashes = entry.contentHashes;

    if (!hashes) {
      return 'Content hashes pending';
    }

    return [
      `MD5: ${hashes.md5}`,
      `SHA-1: ${hashes.sha1}`,
      `SHA-256: ${hashes.sha256}`,
      `SHA-512: ${hashes.sha512}`,
    ].join('\n');
  }

  signatureTooltip(entry: AdminFileManagerEntry): string {
    const signature = entry.signature;

    if (!signature || signature.status === 'pending') {
      return 'Signature pending';
    }

    return [
      `Status: ${signature.status}`,
      `Alg: ${signature.alg ?? '—'}`,
      `Version: ${signature.version ?? '—'}`,
      `Tenant: ${signature.tenantId ?? '—'}`,
      `Signed at: ${signature.signedAt ?? '—'}`,
      `Signature: ${signature.value ?? '—'}`,
    ].join('\n');
  }

  onDownloadEntry(entry: AdminFileManagerEntry, event?: Event): void {
    event?.stopPropagation();
    this.selectedPath.set(entry.path);
    this.selectedType.set(entry.type);

    const state = this.state();

    if (!state) {
      return;
    }

    const params = {
      path: entry.path,
      view: state.view,
      viewTenantId: state.view === 'unified' ? undefined : (state.viewTenantId ?? this.homeTenantId),
    };

    if (entry.type === 'file') {
      this.facade.downloadFile(params, entry.name);

      return;
    }

    this.facade.downloadArchive(params);
  }

  refreshRoot(): void {
    this.facade.refresh();
  }
}
