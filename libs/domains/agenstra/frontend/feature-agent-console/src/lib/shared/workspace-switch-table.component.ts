import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  computed,
  effect,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import type { ClientResponseDto } from '@forepath/agenstra/frontend/data-access-agent-console';
import {
  FPC_DEFAULT_PAGE_SIZE,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';

import { resolveNamedDisplayLabel } from '../display-name.util';

const CURRENT_LABEL = $localize`:@@featureAgentConsoleWorkspaceSwitch-current:Current workspace`;

/** Row id of the optional "All workspaces" entry (see `allOption`). */
export const WORKSPACE_SWITCH_ALL_ID = '__all-workspaces__';

/** Optional leading entry for pages that also show every workspace combined (e.g. the admin overview). */
export interface WorkspaceSwitchAllOption {
  label: string;
  description?: string;
}
const OTHER_LABEL = $localize`:@@featureAgentConsoleWorkspaceSwitch-other:Available`;

/**
 * Workspace switch list of the tickets / knowledge / tasks boards as a data table (3.38 decision 7: rails and switch
 * lists are tables): State (current / available) · Workspace · Description; row click switches. The search is the
 * table's own field; the boards query the server with it (`[(query)]`).
 *
 * Server paging over the append-style clients store (same pattern as the chat workspaces rail): the current page is
 * sliced from the loaded rows, and `loadMore` asks for the next batch until the page (+1 row for "next") is filled.
 */
@Component({
  selector: 'framework-workspace-switch-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FpcDataTableComponent, FpcEmptyStateComponent],
  // Flex child of the modal body (`[bodyScroll]="false"`): the table takes the bounded height, so only its rows scroll
  // while the search / column heads and the pager stay put.
  host: { class: 'd-flex flex-column flex-grow-1 min-h-0' },
  template: `
    <fpc-data-table
      [ariaLabel]="title"
      [columns]="columns"
      [rows]="pageRows()"
      [activeRowId]="activeRowId()"
      paging="server"
      [(page)]="page"
      [(pageSize)]="pageSize"
      [hasNext]="hasNext()"
      [(query)]="query"
      [searchPlaceholder]="searchPlaceholder"
      [filtered]="!!query().trim()"
      [loading]="tableLoading()"
      [error]="appendError()"
      persistKey="agenstra-workspace-switch"
      emptyIcon="building"
      (rowActivate)="onRowActivate($event)"
      data-testid="workspace-switch-table"
    >
      <span fpcDataTableEmpty>
        <fpc-empty-state icon="building" size="sm" [message]="emptyLabel" />
      </span>
    </fpc-data-table>
  `,
})
export class WorkspaceSwitchTableComponent {
  readonly clients = input<readonly ClientResponseDto[]>([]);
  readonly currentId = input<string | null>(null);
  readonly loading = input(false, { transform: booleanAttribute });
  /** The server has further batches beyond `clients` (clients store `hasMore$`). */
  readonly hasMore = input(false, { transform: booleanAttribute });
  /** A further batch is loading (clients store `appendLoading$`). */
  readonly appendLoading = input(false, { transform: booleanAttribute });
  /** The last further-batch load failed (clients store `appendError$`); stops auto-loading. */
  readonly appendError = input<string | null>(null);
  readonly query = model('');

  /** Leading "All workspaces" row (hidden while searching); `currentId` `null` marks it current. */
  readonly allOption = input<WorkspaceSwitchAllOption | null>(null);

  readonly selectWorkspace = output<ClientResponseDto>();
  /** The "All workspaces" row was chosen (only with `allOption`). */
  readonly selectAll = output<void>();
  /** Load the next batch of workspaces (clients facade `loadMoreClients()`). */
  readonly loadMore = output<void>();

  protected readonly page = signal(1);
  protected readonly pageSize = signal(FPC_DEFAULT_PAGE_SIZE);

  /** The clients, led by the "All workspaces" row when `allOption` is set and no search is active. */
  protected readonly rows = computed<readonly ClientResponseDto[]>(() => {
    const all = this.allOption();

    if (!all || this.query().trim()) return this.clients();

    return [
      { id: WORKSPACE_SWITCH_ALL_ID, name: all.label, description: all.description ?? '' } as ClientResponseDto,
      ...this.clients(),
    ];
  });
  protected readonly activeRowId = computed(() =>
    this.allOption() && this.currentId() === null ? WORKSPACE_SWITCH_ALL_ID : this.currentId(),
  );
  protected readonly pageRows = computed(() => {
    const size = this.pageSize();
    const start = (this.page() - 1) * size;

    return this.rows().slice(start, start + size);
  });
  protected readonly hasNext = computed(() => this.rows().length > this.page() * this.pageSize() || this.hasMore());
  protected readonly tableLoading = computed(
    () => this.loading() || (this.appendLoading() && this.pageRows().length === 0),
  );

  constructor() {
    // Fetch further batches until the current page (+1 row) is filled.
    effect(() => {
      const needed = this.page() * this.pageSize() + 1;

      if (
        this.rows().length < needed &&
        this.hasMore() &&
        !this.loading() &&
        !this.appendLoading() &&
        !this.appendError()
      ) {
        untracked(() => this.loadMore.emit());
      }
    });
  }

  protected onRowActivate(row: ClientResponseDto): void {
    if (row.id === WORKSPACE_SWITCH_ALL_ID) {
      this.selectAll.emit();

      return;
    }

    this.selectWorkspace.emit(row);
  }

  protected readonly title = $localize`:@@featureAgentConsoleWorkspaceSwitch-title:Workspaces`;
  protected readonly searchPlaceholder = $localize`:@@featureAgentConsoleWorkspaceSwitch-search:Search workspaces`;
  protected readonly emptyLabel = $localize`:@@featureAgentConsoleWorkspaceSwitch-empty:No workspaces yet`;

  protected readonly columns: FpcTableColumn<ClientResponseDto>[] = [
    {
      id: 'state',
      label: $localize`:@@featureAgentConsoleWorkspaceSwitch-colState:State`,
      type: 'state',
      state: (client) =>
        client.id === this.activeRowId()
          ? { label: CURRENT_LABEL, tone: 'primary', icon: 'check2-circle', severity: 0 }
          : {
              label: OTHER_LABEL,
              tone: 'neutral',
              icon: client.id === WORKSPACE_SWITCH_ALL_ID ? 'buildings' : 'building',
              severity: 1,
            },
    },
    {
      id: 'name',
      label: $localize`:@@featureAgentConsoleWorkspaceSwitch-colName:Workspace`,
      value: (client) => resolveNamedDisplayLabel(client.name),
      required: true,
      priority: 1,
    },
    {
      id: 'description',
      label: $localize`:@@featureAgentConsoleWorkspaceSwitch-colDescription:Description`,
      value: (client) => client.description ?? '',
      priority: 2,
    },
  ];
}
