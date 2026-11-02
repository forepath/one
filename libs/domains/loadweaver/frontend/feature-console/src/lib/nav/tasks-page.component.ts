import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  FpcAlertComponent,
  fpcCopyText,
  FpcDataTableComponent,
  type FpcMenuItem,
  FpcPageHeaderComponent,
  type FpcTableColumn,
  FpcTableCellDirective,
  type FpcTableSort,
} from '@forepath/shared/frontend/ui-components';

import { LoadweaverTaskControlsComponent } from './task-controls.component';
import { taskKindLabel, taskState, taskUrl } from './task-dock.component';
import { dlCopyIdItem, dlOpenItem } from '../section/data-list';
import { ConsoleTaskFeedService } from './task-feed.service';
import { matchesTask, type TaskEntry, taskTargetId } from './tasks';
import { savedViewBinding } from '../views/saved-views';
import { LoadweaverSavedViewsComponent } from '../views/saved-views.component';

/**
 * Activity › Tasks (3.37 P4): every running and recent task of the dock, as a table, with the dock's controls. 3.38:
 * title "Tasks", the table's own toolbar strip ("Search tasks", Views), translated status as a tone badge.
 */
@Component({
  selector: 'loadweaver-tasks-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    LoadweaverSavedViewsComponent,
    DatePipe,
    FpcAlertComponent,
    FpcDataTableComponent,
    FpcPageHeaderComponent,
    FpcTableCellDirective,
    LoadweaverTaskControlsComponent,
  ],
  host: { class: 'd-flex flex-column flex-grow-1 min-h-0' },
  template: `
    <div class="fpc-page">
      <fpc-page-header [title]="title" />
      @if (feed.controlError(); as message) {
        <fpc-alert
          variant="danger"
          [flush]="true"
          [message]="message"
          [dismissible]="true"
          (closed)="feed.controlError.set(null)"
          data-testid="tasks-control-error"
        />
      }
      <fpc-data-table
        class="flex-grow-1 min-h-0"
        [columns]="columns"
        [rows]="rows()"
        [rowId]="rowId"
        [rowLink]="taskLink"
        paging="client"
        persistKey="lw-tasks"
        [rowMenu]="rowMenu"
        (rowAction)="onRowAction($event.row, $event.item.id)"
        emptyIcon="check2-circle"
        [(query)]="query"
        [(visibleColumns)]="columnsShown"
        [(sort)]="sort"
        [searchPlaceholder]="searchLabel"
        [refreshable]="true"
        [loading]="feed.loading()"
        (refresh)="feed.refreshNow()"
        data-testid="tasks-table"
      >
        <loadweaver-saved-views fpcDataTableToolbar scope="tasks" [binding]="views" />
        <ng-template fpcTableCell="at" let-row>{{ row.at ? (row.at | date: 'short') : '' }}</ng-template>
        <ng-template fpcTableCell="controls" let-row><loadweaver-task-controls [task]="row" /></ng-template>
      </fpc-data-table>
    </div>
  `,
})
export class LoadweaverTasksPageComponent implements OnInit {
  readonly feed = inject(ConsoleTaskFeedService);
  private readonly router = inject(Router);

  readonly query = signal('');
  readonly columnsShown = signal<readonly string[] | null>(null);
  readonly sort = signal<FpcTableSort | null>(null);
  /** "Views ▾" (3.37): saved search, columns and sort of the task list, per user. */
  readonly views = savedViewBinding({ query: this.query, columns: this.columnsShown, sort: this.sort });
  readonly rows = computed(() => this.feed.tasks().filter((t) => matchesTask(t, this.query())));
  readonly rowId = (row: TaskEntry) => row.id;
  readonly title = $localize`:@@lwConsoleNav-tasks:Tasks`;
  readonly searchLabel = $localize`:@@lwConsoleDock-search:Search tasks`;
  /** 3.38 D1: State · Task (link) · kind · progress · started · controls (the dominant inline action); ⋮ Open / Copy ID. */
  readonly columns: FpcTableColumn<TaskEntry>[] = [
    { id: 'status', label: $localize`:@@lwConsoleWorkspace-status:Status`, type: 'state', state: taskState },
    {
      id: 'title',
      label: $localize`:@@lwConsoleTasks-colTask:Task`,
      value: (r) => r.title,
      required: true,
      priority: 1,
    },
    { id: 'kind', label: $localize`:@@lwConsoleWorkspace-kind:Kind`, value: (r) => taskKindLabel(r.kind), priority: 2 },
    {
      id: 'progress',
      label: $localize`:@@lwConsoleTasks-colProgress:Progress`,
      value: (r) => (r.progress === null ? '' : `${r.progress} %`),
      align: 'end',
      priority: 3,
    },
    { id: 'at', label: $localize`:@@lwConsoleTasks-colStarted:Started`, value: (r) => r.at ?? '', priority: 1 },
    { id: 'controls', label: $localize`:@@lwConsoleTasks-colControls:Controls`, sortable: false, align: 'end' },
  ];
  readonly taskLink = (task: TaskEntry): string => taskUrl(task);
  readonly rowMenu = (): FpcMenuItem[] => [dlOpenItem(), dlCopyIdItem()];

  onRowAction(task: TaskEntry, action: string): void {
    if (action === 'open') void this.router.navigateByUrl(taskUrl(task));
    else if (action === 'copy-id') fpcCopyText(taskTargetId(task));
  }

  ngOnInit(): void {
    this.feed.refreshNow();
  }
}
