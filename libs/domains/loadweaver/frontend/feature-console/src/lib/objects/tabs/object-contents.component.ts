import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  FpcButtonComponent,
  FpcConfirmDialogComponent,
  FpcDataTableComponent,
  type FpcFilterChip,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  type FpcMenuItem,
  FpcSectionRowComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
  type FpcTableColumn,
  FpcTableCellDirective,
  type FpcTableRowActionEvent,
  type FpcTableSort,
} from '@forepath/shared/frontend/ui-components';

import { matchesParsedSearch, parseSearch, searchChips } from '../../list-search';
import { workspaceHealthState, workspaceKindIcon } from '../../workspace/workspace-format';
import { resourceDocument } from '../../workspace/workspace-draft';
import { workspaceStatus, type WorkspaceItem } from '../../workspace/workspace-model';
import { parseLabel, withDocumentLabel } from '../create-wizard';
import type { WorkspaceAction } from '../../workspace/workspace-actions';
import {
  contentsCreateTarget,
  contentsQueryFromParams,
  contentsRows,
  removeContentsTerm,
  type ContentsScope,
} from '../object-contents';
import { LoadweaverCreateKindButtonComponent } from '../../nav/create-kind-button.component';
import { SCHEMA_KIND_LABELS } from '../schema-form-labels';
import { objectRoute } from '../object-route';
import { itemSearchDocument, RESOURCE_SEARCH_FIELDS } from '../resource-tree';
import { actionMenuItems, ResourcesContextService } from '../resources-context.service';
import { savedViewBinding } from '../../views/saved-views';
import { LoadweaverLaneComponent } from '../../section/lane.component';
import { LoadweaverNodePlatformComponent } from './node-platform.component';
import { LoadweaverSavedViewsComponent } from '../../views/saved-views.component';

/**
 * Contents of a scope (3.37, Proxmox "Search" tab): every object of the cluster / site / node / project / deployment in
 * `fpc-data-table` — `SearchSyntax` search with chips (`?q=`, link filters `?kind=&project=&status=`), sort, columns,
 * row "More" from `workspaceActions()`, ● for draft changes; batch "Delete in draft" behind one confirm.
 */
const TABLE_LABELS = {
  columns: $localize`:@@lwConsoleContents-columns:Columns`,
  refresh: $localize`:@@lwConsoleResources-refresh:Refresh`,
  selected: $localize`:@@lwConsoleContents-selected:{count} selected`,
  clearSelection: $localize`:@@lwConsoleContents-clearSelection:Clear selection`,
  more: $localize`:@@lwConsoleContents-more:More`,
  changed: $localize`:@@lwConsoleResources-changed:Changed in the draft`,
};

/** Empty states of the Contents tables (3.38: empty ≠ no matches; "No matches" comes from the table while searching). */
const EMPTY_TEXT = {
  workloads: $localize`:@@lwConsoleContents-emptyWorkloads:No workloads on this node`,
  /** The node runs platform components (2026-10-30): listed below the table, so it isn't "nothing runs here". */
  userWorkloads: $localize`:@@lwConsoleContents-emptyUserWorkloads:No user workloads on this node`,
  volumes: $localize`:@@lwConsoleContents-emptyVolumes:No volumes on this node`,
  policies: $localize`:@@lwConsoleContents-emptyPolicies:No policies yet`,
  cluster: $localize`:@@lwConsoleContents-emptyCluster:No objects in the cluster yet`,
  site: $localize`:@@lwConsoleContents-emptySite:No objects on this site yet`,
  node: $localize`:@@lwConsoleContents-emptyNode:Nothing runs on this node yet`,
  project: $localize`:@@lwConsoleContents-emptyProject:No objects in this project yet`,
  deployment: $localize`:@@lwConsoleContents-emptyDeployment:No objects in this deployment yet`,
};

@Component({
  selector: 'loadweaver-object-contents',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    LoadweaverCreateKindButtonComponent,
    LoadweaverSavedViewsComponent,
    LoadweaverNodePlatformComponent,
    LoadweaverLaneComponent,
    NgTemplateOutlet,
    FormsModule,
    FpcButtonComponent,
    FpcConfirmDialogComponent,
    FpcDataTableComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcTableCellDirective,
    FpcSectionRowComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
  ],
  host: { class: 'd-flex flex-column flex-grow-1 min-h-0' },
  template: `
    <ng-template #contentsTable>
      <fpc-data-table
        class="flex-grow-1 min-h-0"
        [columns]="columns"
        [rows]="rows()"
        [rowId]="rowId"
        [rowLink]="rowLink"
        paging="client"
        persistKey="lw-object-contents"
        [ariaLabel]="ariaLabel()"
        [labels]="tableLabels()"
        [emptyIcon]="emptyState().icon"
        [(query)]="query"
        [(visibleColumns)]="columnsShown"
        [(sort)]="sort"
        [searchPlaceholder]="searchLabel"
        [searchTitle]="searchHint"
        [chips]="chips()"
        [refreshable]="true"
        [loading]="context.loading()"
        [selectable]="true"
        [(selected)]="selected"
        [rowMenu]="rowMenu"
        [rowMark]="rowMark"
        (rowActivate)="open($event)"
        (rowAction)="onRowAction($event)"
        (removeChip)="removeChip($event)"
        (clearChips)="setQuery('')"
        (refresh)="refresh()"
        data-testid="object-contents"
      >
        <loadweaver-saved-views fpcDataTableToolbar scope="contents" [binding]="views" />
        <!-- Filtered to one creatable kind: its table-head "+" (2026-10-29); mixed kinds rely on the top-bar "+". -->
        @if (createTarget(); as target) {
          <loadweaver-create-kind-button fpcDataTableToolbar [kind]="target.kind" [project]="target.project" />
        }
        <ng-template fpcTableCell="name" let-row>
          <i class="bi {{ kindIcon(row.typeName) }} me-1 text-body-secondary" aria-hidden="true"></i>{{ row.label }}
        </ng-template>
        <div fpcDataTableBatch class="d-flex flex-wrap align-items-center gap-2">
          <fpc-button
            variant="secondary"
            size="sm"
            (clicked)="labelOpen.set(true)"
            data-testid="contents-batch-label"
            iconOnly
            [ariaLabel]="labelLabel"
            [title]="labelLabel"
          >
            <i class="bi bi-tag" aria-hidden="true"></i>
          </fpc-button>
          @for (act of batchActs(); track act.id) {
            <fpc-button
              variant="secondary"
              size="sm"
              (clicked)="pendingBatch.set(act)"
              [attr.data-testid]="'contents-batch-' + act.id"
              iconOnly
              [ariaLabel]="act.label"
              [title]="act.label"
            >
              <i class="bi {{ act.icon }}" aria-hidden="true"></i>
            </fpc-button>
          }
          <fpc-button
            variant="danger"
            size="sm"
            (clicked)="batchOpen.set(true)"
            data-testid="contents-batch-delete"
            iconOnly
            [ariaLabel]="deleteLabel"
            [title]="deleteLabel"
          >
            <i class="bi bi-trash" aria-hidden="true"></i>
          </fpc-button>
        </div>
      </fpc-data-table>
    </ng-template>

    <!-- Node "Workloads" (2026-10-30): two lanes, user workloads 2 : platform components 1 (read-only, searchable); below
         md the lane tabs switch between them, like the project's Images tab. Other scopes: the table alone. -->
    @if (platformNode(); as node) {
      <fpc-tab-group
        class="fpc-lane-tabs"
        [activeId]="lane()"
        (activeIdChange)="lane.set($any($event))"
        [ariaLabel]="lanesLabel"
      >
        <fpc-tab id="workloads" [label]="workloadsLaneTitle" />
        <fpc-tab id="platform" [label]="platformLaneTitle" />
      </fpc-tab-group>
      <fpc-section-row class="flex-grow-1 min-h-0" data-testid="node-workloads-lanes">
        <loadweaver-lane [title]="workloadsLaneTitle" grow="2 1 0" [flush]="true" [off]="lane() !== 'workloads'">
          <ng-container [ngTemplateOutlet]="contentsTable" />
        </loadweaver-lane>
        <loadweaver-lane
          [title]="platformLaneTitle"
          grow="1 1 0"
          [flush]="true"
          [off]="lane() !== 'platform'"
          data-testid="node-platform-lane"
        >
          <loadweaver-node-platform
            class="flex-grow-1"
            [node]="node"
            [reloadKey]="platformReload()"
            (loaded)="platformCount.set($event)"
          />
        </loadweaver-lane>
      </fpc-section-row>
    } @else {
      <ng-container [ngTemplateOutlet]="contentsTable" />
    }

    <!-- Labelling the selection is an action with an input → modal (3.38 decision 12). -->
    <fpc-modal [open]="labelOpen()" (openChange)="labelOpen.set($event)" [title]="labelLabel">
      <form (ngSubmit)="labelSelected()">
        <fpc-form-field forId="lw-contents-label" [label]="labelFieldLabel" [hint]="labelHint">
          <fpc-form-control
            controlId="lw-contents-label"
            name="label"
            size="sm"
            controlClass="font-monospace"
            [placeholder]="labelPlaceholder"
            [invalid]="!!labelInput() && !parsedLabel()"
            [ngModel]="labelInput()"
            (ngModelChange)="labelInput.set($event)"
            data-testid="contents-batch-label-input"
          />
        </fpc-form-field>
      </form>
      <div *fpcModalFooter class="d-flex justify-content-end gap-2">
        <fpc-button variant="dark" (clicked)="labelOpen.set(false)">{{ cancelLabel }}</fpc-button>
        <fpc-button
          variant="primary"
          [disabled]="!parsedLabel()"
          (clicked)="labelSelected()"
          data-testid="contents-batch-label-apply"
          >{{ labelLabel }}</fpc-button
        >
      </div>
    </fpc-modal>

    <fpc-confirm-dialog
      [open]="!!pendingBatch()"
      (openChange)="$event || pendingBatch.set(null)"
      [title]="batchActTitle"
      [message]="batchActMessage()"
      [confirmLabel]="pendingBatch()?.label ?? ''"
      [cancelLabel]="cancelLabel"
      [danger]="!!pendingBatch()?.confirm?.danger"
      (confirmed)="runBatch()"
    />

    <fpc-confirm-dialog
      [(open)]="batchOpen"
      [title]="batchTitle"
      [message]="batchMessage()"
      [confirmLabel]="deleteLabel"
      [cancelLabel]="cancelLabel"
      [danger]="true"
      (confirmed)="deleteSelected()"
    />
  `,
})
export class LoadweaverObjectContentsComponent implements OnInit {
  readonly context = inject(ResourcesContextService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly scope = input<ContentsScope>({ kind: 'cluster' });
  /** A preset query (e.g. `kind:Policy` for the Cluster's Policies tab); the URL's `?q=` adds to it. */
  readonly preset = input('');
  readonly ariaLabel = input<string | null>(null);

  readonly query = signal('');
  readonly columnsShown = signal<readonly string[] | null>(null);
  readonly sort = signal<FpcTableSort | null>(null);
  /** "Views ▾" (3.37): saved search, columns and sort of the Contents tables, per user. */
  readonly views = savedViewBinding({ query: this.query, columns: this.columnsShown, sort: this.sort });
  readonly selected = signal<readonly string[]>([]);
  /** The node whose platform components the "Workloads" tab lists below the table (null: other tabs / scopes). */
  readonly platformNode = computed(() => {
    const scope = this.scope();

    return scope.kind === 'node' && this.preset().trim() === '-kind:Volume' ? scope.name : null;
  });
  readonly platformCount = signal(0);
  /** Lane shown below md (lane tabs); both lanes from md up. */
  readonly lane = signal<'workloads' | 'platform'>('workloads');
  readonly lanesLabel = $localize`:@@lwConsoleContents-nodeLanes:Workloads and platform components`;
  readonly workloadsLaneTitle = $localize`:@@lwConsoleContents-userWorkloadsLane:User workloads`;
  readonly platformLaneTitle = $localize`:@@lwConsoleNodePlatform-title:Platform`;
  readonly platformReload = signal(0);
  readonly batchOpen = signal(false);
  readonly labelInput = signal('');
  /** The label modal (3.38 decision 12). */
  readonly labelOpen = signal(false);
  /** An immediate action offered by every selected row, waiting for its one confirmation. */
  readonly pendingBatch = signal<WorkspaceAction | null>(null);
  readonly batchActTitle = $localize`:@@lwConsoleContents-batchActTitle:Run this action on every selected object?`;
  /** Immediate actions every selected row offers (node lifecycle, VM power, backup now …). */
  readonly batchActs = computed<WorkspaceAction[]>(() => {
    const ids = new Set(this.selected());
    const rows = this.rows().filter((r) => ids.has(r.id));

    if (rows.length < 2) return [];

    const [first, ...rest] = rows.map((r) =>
      this.context.actionsOf(r).filter((a) => a.group === 'act' && !a.disabled && !a.join),
    );

    return first.filter((a) => rest.every((list) => list.some((b) => b.id === a.id)));
  });
  readonly batchActMessage = computed(() => {
    const action = this.pendingBatch();
    const ids = new Set(this.selected());
    const names = this.rows()
      .filter((r) => ids.has(r.id))
      .map((r) => r.label);

    return action ? `${action.label}: ${names.join(', ')}` : '';
  });
  readonly parsedLabel = computed(() => parseLabel(this.labelInput()));
  readonly labelLabel = $localize`:@@lwConsoleContents-batchLabel:Label in draft`;
  readonly labelFieldLabel = $localize`:@@lwConsoleContents-batchLabelField:Label`;
  readonly labelHint = $localize`:@@lwConsoleContents-batchLabelHint:Sets this label on every selected resource you may change, in the draft.`;
  readonly labelPlaceholder = $localize`:@@lwConsoleContents-batchLabelPlaceholder:key=value`;

  readonly searchLabel = $localize`:@@lwConsoleContents-search:Search resources`;
  /** Syntax help in the field's title (3.38 R11: no syntax in the placeholder). */
  readonly searchHint = $localize`:@@lwConsoleContents-searchHint:Filter with kind:, project:, status: or node: (prefix - to exclude)`;
  readonly deleteLabel = $localize`:@@lwConsoleWorkspace-actionDelete:Delete in draft`;
  readonly cancelLabel = $localize`:@@lwConsoleWorkspace-cancel:Cancel`;
  readonly batchTitle = $localize`:@@lwConsoleContents-batchTitle:Delete the selected objects in the draft?`;
  /** The table's empty state (no rows, nothing typed): what this tab lists, in its scope. */
  readonly emptyState = computed<{ icon: string; title: string }>(() => {
    const preset = this.preset().trim();
    const scope = this.scope().kind;

    if (preset === 'kind:Volume') return { icon: 'hdd', title: EMPTY_TEXT.volumes };
    if (preset === '-kind:Volume')
      return {
        icon: 'box-seam',
        title: this.platformNode() && this.platformCount() > 0 ? EMPTY_TEXT.userWorkloads : EMPTY_TEXT.workloads,
      };
    if (preset === 'kind:Policy') return { icon: 'shield', title: EMPTY_TEXT.policies };

    return { icon: 'inbox', title: EMPTY_TEXT[scope] };
  });
  readonly tableLabels = computed(() => ({ ...TABLE_LABELS, empty: this.emptyState().title }));
  /** 3.38 D1: State · Name (link) · kind · project · placement. */
  readonly columns: FpcTableColumn<WorkspaceItem>[] = [
    {
      id: 'status',
      label: $localize`:@@lwConsoleWorkspace-status:Status`,
      type: 'state',
      state: (r) => workspaceHealthState(workspaceStatus(r)),
    },
    {
      id: 'name',
      label: $localize`:@@lwConsoleContents-name:Name`,
      value: (r) => r.label,
      required: true,
      priority: 1,
    },
    { id: 'kind', label: $localize`:@@lwConsoleWorkspace-kind:Kind`, value: (r) => r.typeName, priority: 1 },
    { id: 'project', label: $localize`:@@lwConsoleWorkspace-project:Project`, value: (r) => r.project ?? '—' },
    {
      id: 'placement',
      label: $localize`:@@lwConsoleContents-placement:Placement`,
      value: (r) => r.placement ?? '—',
    },
  ];

  readonly kindIcon = workspaceKindIcon;
  readonly rowId = (row: WorkspaceItem) => row.id;
  readonly rowLink = (row: WorkspaceItem): string | null => {
    const route = objectRoute(row);

    return route ? route.map((part, i) => (i === 0 ? part : encodeURIComponent(part))).join('/') : null;
  };
  readonly rowMark = (row: WorkspaceItem) => this.context.changedIds().has(row.id);
  readonly rowMenu = (row: WorkspaceItem): FpcMenuItem[] => actionMenuItems(this.context.actionsOf(row));

  private readonly parsed = computed(() =>
    parseSearch(`${this.preset()} ${this.query()}`.trim(), RESOURCE_SEARCH_FIELDS),
  );
  readonly createTarget = computed(() =>
    contentsCreateTarget(this.parsed(), this.scope(), Object.keys(SCHEMA_KIND_LABELS)),
  );
  readonly chips = computed<FpcFilterChip[]>(() => searchChips(parseSearch(this.query(), RESOURCE_SEARCH_FIELDS)));
  readonly rows = computed(() => {
    const parsed = this.parsed();

    return contentsRows(this.context.model(), this.scope()).filter((item) =>
      matchesParsedSearch(parsed, itemSearchDocument(item)),
    );
  });
  /** Batch actions write into the draft (a new one is started when none is open). */
  readonly mayDraft = computed(() => !!this.context.draft && this.context.model().items.some((i) => this.editable(i)));
  readonly batchMessage = computed(() => {
    const names = this.deletable().map((i) => i.label);

    return $localize`:@@lwConsoleContents-batchMessage:${names.length}:count: objects go into the draft as deletions: ${names.join(', ')}:names:. Nothing changes until the plan is applied.`;
  });

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;

    this.query.set(
      contentsQueryFromParams({
        q: params.get('q'),
        kind: params.get('kind'),
        project: params.get('project'),
        status: params.get('status'),
      }),
    );
  }

  /** The table's refresh: the workspace model and the node's platform components. */
  refresh(): void {
    this.context.reload();
    this.platformReload.update((n) => n + 1);
  }

  setQuery(query: string): void {
    this.query.set(query);
  }

  removeChip(chip: FpcFilterChip): void {
    this.query.set(removeContentsTerm(this.query(), chip.id));
  }

  routeOf(item: WorkspaceItem): string[] | null {
    const route = objectRoute(item);

    return route ? [...route] : null;
  }

  open(item: WorkspaceItem): void {
    const route = this.routeOf(item);

    if (route) void this.router.navigate(route);
  }

  onRowAction(event: FpcTableRowActionEvent<WorkspaceItem>): void {
    const action = this.context.actionsOf(event.row).find((a) => a.id === event.item.id);

    if (action) this.context.run(action, event.row);
  }

  private editable(item: WorkspaceItem, action: 'edit' | 'delete' = 'edit'): boolean {
    return !!item.resource && this.context.actionsOf(item).some((a) => a.id === action && a.group === 'draft');
  }

  private deletable(): WorkspaceItem[] {
    const ids = new Set(this.selected());

    return this.rows().filter((item) => ids.has(item.id) && this.editable(item, 'delete'));
  }

  /** Sets the typed `key=value` label on every selected resource the caller may change, in the draft. */
  async labelSelected(): Promise<void> {
    const draft = this.context.draft;
    const label = this.parsedLabel();

    if (!draft || !label) return;

    this.labelOpen.set(false);

    const ids = new Set(this.selected());

    for (const item of this.rows().filter((i) => ids.has(i.id) && this.editable(i))) {
      const document = resourceDocument(item, draft.active());

      if (document) await draft.upsert(withDocumentLabel(document, label.key, label.value));
    }

    this.labelInput.set('');
    this.selected.set([]);
  }

  /** Runs the confirmed immediate action on every selected row (each row's own payload). */
  runBatch(): void {
    const action = this.pendingBatch();
    const ids = new Set(this.selected());

    this.pendingBatch.set(null);

    if (!action) return;

    for (const row of this.rows().filter((r) => ids.has(r.id))) {
      const own = this.context.actionsOf(row).find((a) => a.id === action.id);

      if (own) this.context.runNow(own);
    }

    this.selected.set([]);
  }

  async deleteSelected(): Promise<void> {
    const draft = this.context.draft;

    if (!draft) return;

    for (const item of this.deletable()) if (item.resource) await draft.remove(item.resource);

    this.selected.set([]);
  }
}
