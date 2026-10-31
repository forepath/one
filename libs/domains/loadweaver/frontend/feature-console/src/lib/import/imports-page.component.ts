import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import {
  apiErrorMessage,
  ImportService,
  type ImportSummary,
  type NodeLifecycle,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcPageHeaderComponent,
  FpcTableCellDirective,
  type FpcMenuItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';

import { filterBySearch } from '../list-search';
import { lifecycleLabel } from '../nodes/node-format';
import { dlOpenItem } from '../section/data-list';
import { importStatusLabel, STATUS_TONE } from './import-format';
import { savedViewBinding } from '../views/saved-views';
import { LoadweaverSavedViewsComponent } from '../views/saved-views.component';

/** Hosts that joined for an import (3.21): discovered, waiting for or running their join plan. */
@Component({
  selector: 'loadweaver-imports-page',
  imports: [
    LoadweaverSavedViewsComponent,
    CommonModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcPageHeaderComponent,
    FpcTableCellDirective,
  ],
  templateUrl: './imports-page.component.html',
  standalone: true,
})
export class LoadweaverImportsPageComponent implements OnInit {
  private readonly service = inject(ImportService);

  readonly title = $localize`:@@lwConsoleImport-listTitle:Import hosts`;
  readonly imports = signal<ImportSummary[] | null>(null);
  readonly error = signal<string | null>(null);
  readonly statusTone = STATUS_TONE;
  readonly statusLabel = importStatusLabel;
  readonly loadingLabel = $localize`:@@lwConsoleImport-loadingList:Loading import hosts`;
  readonly search = signal('');
  /** "Views ▾" (3.37): saved search / filters of this list, per user. */
  readonly views = savedViewBinding({ search: this.search });
  readonly filtered = computed(() =>
    filterBySearch(this.imports() ?? [], this.search(), (i) => [i.node, i.hostname, i.lifecycle, i.selection?.status]),
  );

  readonly openLabel = $localize`:@@lwConsoleImport-open:Open import`;
  readonly searchLabel = $localize`:@@lwConsoleImport-search:Search hosts`;
  readonly formerLabel = $localize`:@@lwConsoleImport-formerBadge:former node`;

  /** 3.38 D1: State · Host (link) · hostname · lifecycle · former · discovered counts · discovered at. */
  readonly columns: FpcTableColumn<ImportSummary>[] = [
    {
      id: 'state',
      label: $localize`:@@lwConsoleImport-colState:Status`,
      type: 'state',
      state: (i) =>
        !i.connected
          ? { label: $localize`:@@lwConsoleImport-offline:offline`, tone: 'danger' }
          : i.selection
            ? { label: importStatusLabel(i.selection.status), tone: STATUS_TONE[i.selection.status] }
            : { label: $localize`:@@lwConsoleImport-stateDiscovered:Discovered`, tone: 'info', icon: 'search' },
    },
    {
      id: 'node',
      label: $localize`:@@lwConsoleImport-colHost:Host`,
      value: (i) => i.node,
      required: true,
      priority: 1,
    },
    {
      id: 'hostname',
      label: $localize`:@@lwConsoleImport-colHostname:Hostname`,
      value: (i) => i.hostname,
      priority: 1,
    },
    {
      id: 'lifecycle',
      label: $localize`:@@lwConsoleImport-colLifecycle:Lifecycle`,
      value: (i) => lifecycleLabel(i.lifecycle as NodeLifecycle),
      priority: 3,
    },
    { id: 'former', label: this.formerLabel, value: (i) => (i.former === 'none' ? 0 : 1), width: '3rem', priority: 2 },
    {
      id: 'compose',
      label: $localize`:@@lwConsoleImport-colCompose:Compose projects`,
      value: (i) => i.composeProjects,
      align: 'end',
      priority: 2,
    },
    {
      id: 'containers',
      label: $localize`:@@lwConsoleImport-colContainers:Containers`,
      value: (i) => i.containers,
      align: 'end',
      priority: 2,
    },
    {
      id: 'volumes',
      label: $localize`:@@lwConsoleImport-colVolumes:Volumes`,
      value: (i) => i.volumes,
      align: 'end',
      priority: 3,
    },
    {
      id: 'discovered',
      label: $localize`:@@lwConsoleImport-colDiscovered:Discovered`,
      value: (i) => i.discoveredAt,
      priority: 2,
    },
  ];
  readonly hostId = (i: ImportSummary): string => i.node;
  readonly importLink = (i: ImportSummary): string => `/operate/imports/${encodeURIComponent(i.node)}`;
  readonly rowMenu = (): FpcMenuItem[] => [{ ...dlOpenItem(), label: this.openLabel }];
  private readonly router = inject(Router);

  open(entry: ImportSummary): void {
    void this.router.navigateByUrl(this.importLink(entry));
  }

  ngOnInit(): void {
    this.service.list().subscribe({
      next: (list) => this.imports.set(list),
      error: (error: unknown) =>
        this.error.set(apiErrorMessage(error, $localize`:@@lwConsoleImport-loadError:The import could not be loaded.`)),
    });
  }
}
