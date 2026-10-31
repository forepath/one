import { ChangeDetectionStrategy, Component, booleanAttribute, input, model, output } from '@angular/core';
import type { ClientResponseDto } from '@forepath/agenstra/frontend/data-access-agent-console';
import {
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';

import { resolveNamedDisplayLabel } from '../display-name.util';

const CURRENT_LABEL = $localize`:@@featureAgentConsoleWorkspaceSwitch-current:Current workspace`;
const OTHER_LABEL = $localize`:@@featureAgentConsoleWorkspaceSwitch-other:Available`;

/**
 * Workspace switch list of the tickets / knowledge / tasks boards as a data table (3.38 decision 7: rails and switch
 * lists are tables): State (current / available) · Workspace · Description; row click switches. The search is the
 * table's own field; the boards query the server with it (`[(query)]`).
 */
@Component({
  selector: 'framework-workspace-switch-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FpcDataTableComponent, FpcEmptyStateComponent],
  template: `
    <fpc-data-table
      nested
      [ariaLabel]="title"
      [columns]="columns"
      [rows]="clients()"
      [activeRowId]="currentId()"
      [(query)]="query"
      [searchPlaceholder]="searchPlaceholder"
      [filtered]="!!query().trim()"
      [loading]="loading()"
      paging="client"
      persistKey="agenstra-workspace-switch"
      emptyIcon="building"
      (rowActivate)="selectWorkspace.emit($event)"
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
  readonly query = model('');

  readonly selectWorkspace = output<ClientResponseDto>();

  protected readonly title = $localize`:@@featureAgentConsoleWorkspaceSwitch-title:Workspaces`;
  protected readonly searchPlaceholder = $localize`:@@featureAgentConsoleWorkspaceSwitch-search:Search workspaces`;
  protected readonly emptyLabel = $localize`:@@featureAgentConsoleWorkspaceSwitch-empty:No workspaces yet`;

  protected readonly columns: FpcTableColumn<ClientResponseDto>[] = [
    {
      id: 'state',
      label: $localize`:@@featureAgentConsoleWorkspaceSwitch-colState:State`,
      type: 'state',
      state: (client) =>
        client.id === this.currentId()
          ? { label: CURRENT_LABEL, tone: 'primary', icon: 'check2-circle', severity: 0 }
          : { label: OTHER_LABEL, tone: 'neutral', icon: 'building', severity: 1 },
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
