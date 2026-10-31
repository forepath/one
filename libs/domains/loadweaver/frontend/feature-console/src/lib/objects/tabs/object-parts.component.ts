import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  ConsolePoliciesFacade,
  type GroupMember,
  type GroupMembers,
  type ResourceKey,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcKeyValueListComponent,
  type FpcKeyValueItem,
  FpcSectionRowComponent,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';

import { filterBySearch } from '../../list-search';
import { LoadweaverLaneComponent } from '../../section/lane.component';
import { workspaceHealthLabel, workspaceHealthState } from '../../workspace/workspace-format';
import type { WorkspaceItem } from '../../workspace/workspace-model';

/** Model data the facts leave out: the health (header) and internal ids. */
const HIDDEN_DATA_KEYS = new Set(['health', 'state', 'service_id']);

/** A model data key as a sentence-case label (`lastSeen` / `last_seen` → `Last seen`), never the raw key (D7). */
export function factLabel(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();

  return words ? words[0].toUpperCase() + words.slice(1) : key;
}

/**
 * Summary of an object without a detail page of its own (sites, volumes …): its model facts in a padded "Details"
 * lane (3.38; the health shows once, in the object header).
 */
@Component({
  selector: 'loadweaver-object-facts',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FpcKeyValueListComponent, FpcSectionRowComponent, LoadweaverLaneComponent],
  host: { class: 'd-flex flex-column flex-grow-1 min-h-0' },
  template: `
    @if (item()) {
      <fpc-section-row class="flex-grow-1 min-h-0">
        <loadweaver-lane [title]="detailsTitle" data-testid="object-facts">
          <fpc-key-value-list [items]="facts()" [columns]="2" />
        </loadweaver-lane>
      </fpc-section-row>
    }
  `,
})
export class LoadweaverObjectFactsComponent {
  readonly detailsTitle = $localize`:@@lwConsoleObject-details:Details`;
  readonly item = input<WorkspaceItem | null>(null);
  /** Extra rows (e.g. node counts of a site). */
  readonly extra = input<readonly FpcKeyValueItem[]>([]);

  readonly facts = computed<FpcKeyValueItem[]>(() => {
    const item = this.item();

    if (!item) return [];

    const rows: FpcKeyValueItem[] = [
      { key: 'kind', label: $localize`:@@lwConsoleWorkspace-kind:Kind`, value: item.typeName },
      ...(item.project
        ? [{ key: 'project', label: $localize`:@@lwConsoleWorkspace-project:Project`, value: item.project }]
        : []),
      ...(item.placement
        ? [{ key: 'placement', label: $localize`:@@lwConsoleContents-placement:Placement`, value: item.placement }]
        : []),
      ...(item.status
        ? [
            {
              key: 'status',
              label: $localize`:@@lwConsoleWorkspace-status:Status`,
              value: workspaceHealthLabel(item.status),
            },
          ]
        : []),
    ];

    for (const [key, value] of Object.entries(item.data)) {
      // Health / state show once, as the header glyph + badge (LW-23); internal ids aren't facts (D11).
      if (HIDDEN_DATA_KEYS.has(key)) continue;

      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
        rows.push({ key: `data-${key}`, label: factLabel(key), value: String(value) });
    }

    return [...rows, ...this.extra()];
  });
}

/** The workloads a `WorkloadGroup` selects right now: a "Members" lane with a search (3.38). */
@Component({
  selector: 'loadweaver-group-members',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FpcDataTableComponent, FpcEmptyStateComponent, FpcSectionRowComponent, LoadweaverLaneComponent],
  host: { class: 'd-flex flex-column flex-grow-1 min-h-0' },
  template: `
    <fpc-section-row class="flex-grow-1 min-h-0">
      <loadweaver-lane [title]="membersTitle" [flush]="true">
        <!-- State (health) · Replica · Deployment (link) · Service (3.38 D1). -->
        <fpc-data-table
          class="flex-grow-1 min-h-0"
          [ariaLabel]="membersTitle"
          [columns]="columns"
          [rows]="visible()"
          [rowId]="memberId"
          [rowLink]="memberLink"
          paging="client"
          persistKey="lw-group-members"
          [(query)]="search"
          [searchPlaceholder]="searchLabel"
          emptyIcon="collection"
          data-testid="group-members"
        >
          <span fpcDataTableEmpty>
            <fpc-empty-state icon="collection" size="sm" [title]="emptyTitle" />
          </span>
        </fpc-data-table>
      </loadweaver-lane>
    </fpc-section-row>
  `,
})
export class LoadweaverGroupMembersComponent implements OnInit {
  private readonly facade = inject(ConsolePoliciesFacade);

  readonly groupKey = input.required<ResourceKey>();

  private readonly all = toSignal(this.facade.members$, { initialValue: null as GroupMembers | null });
  readonly members = computed(() => this.all()?.[`${this.groupKey().project ?? ''}/${this.groupKey().name}`] ?? []);
  readonly search = signal('');
  readonly visible = computed(() =>
    filterBySearch(this.members(), this.search(), (m) => [
      m.deployment,
      m.service,
      m.label,
      m.health ? workspaceHealthLabel(m.health) : null,
    ]),
  );
  /** 3.38 D1: State (health) · Replica · Deployment · Service. */
  readonly columns: FpcTableColumn<GroupMember>[] = [
    {
      id: 'health',
      label: $localize`:@@lwConsoleWorkspace-status:Status`,
      type: 'state',
      state: (m) => workspaceHealthState(m.health),
    },
    {
      id: 'replica',
      label: $localize`:@@lwConsoleObjectMembers-colReplica:Replica`,
      value: (m) => m.label,
      required: true,
      priority: 1,
      mono: true,
    },
    {
      id: 'deployment',
      label: $localize`:@@lwConsoleObjectMembers-colDeployment:Deployment`,
      value: (m) => m.deployment ?? '',
      priority: 1,
    },
    { id: 'service', label: $localize`:@@lwConsoleObjectMembers-colService:Service`, value: (m) => m.service ?? '' },
  ];
  readonly memberId = (m: GroupMember) => m.replica;
  readonly memberLink = (m: GroupMember): string | null =>
    m.deployment
      ? `/resources/deployment/${encodeURIComponent(this.groupKey().project ?? '-')}/${encodeURIComponent(m.deployment)}`
      : null;
  readonly membersTitle = $localize`:@@lwConsoleObject-tabMembers:Members`;
  readonly searchLabel = $localize`:@@lwConsoleObjectMembers-search:Search members`;
  readonly emptyTitle = $localize`:@@lwConsoleObject-noMembers:No workloads are in this group right now`;

  ngOnInit(): void {
    this.facade.load();
  }
}
