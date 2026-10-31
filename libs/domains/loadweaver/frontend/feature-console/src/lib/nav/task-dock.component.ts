import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  type FpcBadgeTone,
  FpcButtonComponent,
  FpcButtonGroupComponent,
  FpcDockPanelComponent,
  fpcCopyText,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  type FpcMenuItem,
  FpcProgressComponent,
  FpcSearchFieldComponent,
  FpcSpinnerComponent,
  FpcTableCellDirective,
  type FpcTableColumn,
  type FpcTableState,
} from '@forepath/shared/frontend/ui-components';

import { ConsoleTaskFeedService } from './task-feed.service';
import { LoadweaverTaskControlsComponent } from './task-controls.component';
import { dlCopyIdItem, dlOpenItem } from '../section/data-list';
import { type EventEntry, matchesTask, type TaskEntry, taskStatusLabel, taskTargetId } from './tasks';

/** Tone of a task's status badge. */
export function taskTone(task: Pick<TaskEntry, 'running' | 'failed'>): 'info' | 'danger' | 'success' {
  return task.failed ? 'danger' : task.running ? 'info' : 'success';
}

/** A task's kind as a readable label (3.38 D9). */
export function taskKindLabel(kind: TaskEntry['kind']): string {
  switch (kind) {
    case 'plan':
      return $localize`:@@lwConsoleTasks-kindPlan:Plan`;
    case 'rollout':
      return $localize`:@@lwConsoleTasks-kindRollout:Update rollout`;
    case 'restore':
      return $localize`:@@lwConsoleTasks-kindRestore:Restore`;
    case 'node':
      return $localize`:@@lwConsoleTasks-kindNode:Node lifecycle`;
    case 'fleet-operation':
      return $localize`:@@lwConsoleTasks-kindFleetOperation:Fleet operation`;
    default:
      return kind;
  }
}

/** A task's State cell (3.38 D2): readable status + tone (+ icon from the tone). */
export function taskState(task: TaskEntry): FpcTableState {
  return { label: taskStatusLabel(task), tone: taskTone(task), ...(task.running ? { icon: 'arrow-repeat' } : {}) };
}

/** A task's link as a URL (route + query), for `rowLink`. */
export function taskUrl(task: Pick<TaskEntry, 'link' | 'queryParams'>): string {
  const [root, ...rest] = task.link;
  const path = [root, ...rest.map((part) => encodeURIComponent(part))].join('/');
  const query = new URLSearchParams(task.queryParams ?? {}).toString();

  return query ? `${path}?${query}` : path;
}

/**
 * Bottom task dock (3.37 P4): collapsible, resizable (persisted) panel in the content column with Tasks (running
 * first; plans, rollouts, restores, node lifecycles) and Events (audit + alert fires / resolves), its own filter.
 * Filter and the Tasks / Events triggers sit on the right of the dock's header strip (always visible, wraps when narrow). The top bar's running badge and `` ` `` toggle it.
 */
@Component({
  selector: 'loadweaver-task-dock',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcButtonGroupComponent,
    FpcDockPanelComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcProgressComponent,
    FpcSearchFieldComponent,
    FpcSpinnerComponent,
    FpcTableCellDirective,
    LoadweaverTaskControlsComponent,
  ],
  template: `
    <fpc-dock-panel
      #dock
      [title]="title"
      [collapsed]="!feed.open()"
      (collapsedChange)="feed.open.set(!$event)"
      storageKey="lw.dock"
      [expandLabel]="expandLabel"
      [collapseLabel]="collapseLabel"
      [resizeLabel]="resizeLabel"
      fill
      data-testid="task-dock"
    >
      <!--
        Header slot (grows): spinner by the title, filter (open only) pushed right, just left of the Tasks / Events
        triggers in the actions slot. Everything lives in the header strip (not the scrolling body), so nothing scrolls /
        shrinks away. On phones the triggers wrap under the title + filter row.
      -->
      <div fpcDockPanelHeader class="lw-dock__header">
        @if (feed.loading()) {
          <fpc-spinner size="sm" />
        }
        @if (feed.open()) {
          <fpc-search-field
            class="lw-dock__search"
            size="sm"
            [placeholder]="tab() === 'tasks' ? searchLabel : searchEventsLabel"
            [ariaLabel]="tab() === 'tasks' ? searchLabel : searchEventsLabel"
            [(value)]="query"
          />
        }
      </div>
      <!-- Dock triggers: collapsed = neither selected; a click opens the dock on that view; the selected one closes it. -->
      <div fpcDockPanelActions class="lw-dock__actions">
        <fpc-button-group class="lw-dock__tabs" size="sm" [ariaLabel]="title" data-testid="task-dock-tabs">
          @for (view of views; track view.id) {
            <fpc-button
              size="sm"
              [variant]="selected() === view.id ? 'primary' : 'dark'"
              [ariaPressed]="selected() === view.id"
              [ariaExpanded]="feed.open()"
              [ariaControls]="dock.bodyId"
              (clicked)="selectTab(view.id)"
              [attr.data-testid]="'task-dock-tab-' + view.id"
            >
              <i class="bi {{ view.icon }} me-1" aria-hidden="true"></i>{{ view.label }}
              @if (view.id === 'tasks' && feed.running() > 0) {
                <fpc-badge class="ms-1" tone="info" [pill]="true" data-testid="task-dock-running"
                  >{{ feed.running() }}<span class="visually-hidden"> {{ runningLabel }}</span></fpc-badge
                >
              }
            </fpc-button>
          }
        </fpc-button-group>
      </div>
      @if (feed.controlError(); as message) {
        <fpc-alert
          variant="danger"
          [flush]="true"
          [message]="message"
          [dismissible]="true"
          (closed)="feed.controlError.set(null)"
          data-testid="task-dock-control-error"
        />
      }
      <!-- Tasks / Events as tables (3.38 D1, decision 2): State · name (link) · facts; the dock's own search. The table
           fills the dock body (fill: flex column, no overflow wrapper) and is its only scroller (sticky head + pinned
           pager in every dock size / the phone sheet). -->
      @if (tab() === 'tasks') {
        <fpc-data-table
          [ariaLabel]="tasksLabel"
          [columns]="taskColumns"
          [rows]="tasks()"
          [rowLink]="taskLink"
          [searchable]="false"
          [showColumnChooser]="false"
          paging="client"
          persistKey="lw-dock-tasks"
          [rowMenu]="taskMenu"
          (rowAction)="onTaskAction($event.row, $event.item.id)"
          emptyIcon="check2-circle"
          data-testid="task-dock-tasks"
        >
          <span fpcDataTableEmpty><fpc-empty-state icon="check2-circle" size="sm" [title]="noTasksLabel" /></span>
          <ng-template fpcTableCell="progress" let-row>
            @if (row.progress !== null) {
              <fpc-progress class="lw-dock__progress" [value]="row.progress" height="0.4rem" />
            }
          </ng-template>
          <ng-template fpcTableCell="at" let-row>{{ row.at ? (row.at | date: 'short') : '' }}</ng-template>
          <ng-template fpcTableCell="controls" let-row><loadweaver-task-controls [task]="row" /></ng-template>
        </fpc-data-table>
      } @else {
        <fpc-data-table
          [ariaLabel]="eventsLabel"
          [columns]="eventColumns"
          [rows]="events()"
          [rowLink]="eventLink"
          [searchable]="false"
          [showColumnChooser]="false"
          paging="client"
          persistKey="lw-dock-events"
          emptyIcon="journal-text"
          data-testid="task-dock-events"
        >
          <span fpcDataTableEmpty><fpc-empty-state icon="journal-text" size="sm" [title]="noEventsLabel" /></span>
          <ng-template fpcTableCell="at" let-row>{{ row.at | date: 'short' }}</ng-template>
        </fpc-data-table>
      }
    </fpc-dock-panel>
  `,
  styles: `
    .lw-dock__progress {
      max-width: 8rem;
    }

    .lw-dock__header,
    .lw-dock__actions {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      min-width: 0;
    }

    // Grows: spinner stays left by the title, the filter is pushed right next to the triggers.
    .lw-dock__header {
      flex: 1 1 auto;
    }

    .lw-dock__tabs {
      flex: 0 0 auto;
    }

    .lw-dock__search {
      margin-left: auto;
      width: 14rem;
      min-width: 8rem;
      flex: 0 1 14rem;
    }
  `,
})
export class LoadweaverTaskDockComponent {
  readonly feed = inject(ConsoleTaskFeedService);
  private readonly router = inject(Router);

  readonly tab = signal<'tasks' | 'events'>('tasks');
  readonly query = signal('');
  readonly tasks = computed(() => this.feed.tasks().filter((t) => matchesTask(t, this.query())));
  readonly events = computed(() => this.feed.events().filter((e) => matchesTask(e, this.query())));
  readonly tone = taskTone;
  readonly statusLabel = taskStatusLabel;
  /** Event colours → `fpc-badge` tones (3.38 R10). */
  readonly eventTone = (tone: string): FpcBadgeTone =>
    tone === 'success' || tone === 'warning' || tone === 'danger' || tone === 'info' || tone === 'primary'
      ? tone
      : 'neutral';

  readonly taskColumns: FpcTableColumn<TaskEntry>[] = [
    {
      id: 'status',
      label: $localize`:@@lwConsoleWorkspace-status:Status`,
      type: 'state',
      state: taskState,
      iconOnly: true,
    },
    {
      id: 'title',
      label: $localize`:@@lwConsoleTasks-colTask:Task`,
      value: (task) => task.title,
      required: true,
      priority: 1,
    },
    { id: 'progress', label: $localize`:@@lwConsoleTasks-colProgress:Progress`, width: '8rem', priority: 2 },
    { id: 'at', label: $localize`:@@lwConsoleTasks-colStarted:Started`, value: (task) => task.at ?? '', priority: 1 },
    { id: 'controls', label: $localize`:@@lwConsoleTasks-colControls:Controls`, align: 'end', priority: 2 },
  ];
  readonly eventColumns: FpcTableColumn<EventEntry>[] = [
    {
      id: 'kind',
      label: $localize`:@@lwConsoleDock-colKind:Source`,
      type: 'state',
      iconOnly: true,
      state: (event) => ({
        label: event.kind === 'alert' ? this.alertLabel : this.auditLabel,
        tone: this.eventTone(event.tone),
        icon: event.kind === 'alert' ? 'bell' : 'journal-text',
      }),
    },
    {
      id: 'title',
      label: $localize`:@@lwConsoleDock-colEvent:Event`,
      value: (event) => event.title,
      required: true,
      priority: 1,
    },
    { id: 'detail', label: $localize`:@@lwConsoleDock-colDetail:Detail`, value: (event) => event.detail, priority: 2 },
    { id: 'at', label: $localize`:@@lwConsoleDock-colAt:When`, value: (event) => event.at, priority: 1 },
  ];
  readonly taskLink = (task: TaskEntry): string => taskUrl(task);
  readonly eventLink = (event: EventEntry): string | null => (event.link ? taskUrl({ link: event.link }) : null);
  readonly taskMenu = (): FpcMenuItem[] => [dlOpenItem(), dlCopyIdItem()];

  onTaskAction(task: TaskEntry, action: string): void {
    if (action === 'open') void this.router.navigateByUrl(taskUrl(task));
    else if (action === 'copy-id') fpcCopyText(taskTargetId(task));
  }

  /** The highlighted view: only while the dock is open (collapsed = no selection). */
  readonly selected = computed(() => (this.feed.open() ? this.tab() : null));

  /** Collapsed: open on that view. Open: switch views, or close when the selected one is clicked again. */
  selectTab(id: 'tasks' | 'events'): void {
    if (this.feed.open() && this.tab() === id) {
      this.feed.open.set(false);
      return;
    }

    this.tab.set(id);
    this.feed.open.set(true);
  }

  readonly title = $localize`:@@lwConsoleDock-title:Tasks & events`;
  readonly tasksLabel = $localize`:@@lwConsoleDock-tasks:Tasks`;
  readonly eventsLabel = $localize`:@@lwConsoleDock-events:Events`;
  readonly runningLabel = $localize`:@@lwConsoleDock-running:running`;
  readonly searchLabel = $localize`:@@lwConsoleDock-search:Search tasks`;
  readonly searchEventsLabel = $localize`:@@lwConsoleDock-searchEvents:Search events`;
  readonly noTasksLabel = $localize`:@@lwConsoleDock-noTasks:Nothing is running`;
  readonly noEventsLabel = $localize`:@@lwConsoleHistory-noEvents:No events yet`;
  readonly alertLabel = $localize`:@@lwConsoleDock-alert:Alert`;
  readonly auditLabel = $localize`:@@lwConsoleDock-audit:Audit`;
  readonly expandLabel = $localize`:@@lwConsoleDock-expand:Show tasks`;
  readonly collapseLabel = $localize`:@@lwConsoleDock-collapse:Hide tasks`;
  readonly resizeLabel = $localize`:@@lwConsoleDock-resize:Resize the task panel`;

  readonly views = [
    { id: 'tasks', label: this.tasksLabel, icon: 'bi-list-task' },
    { id: 'events', label: this.eventsLabel, icon: 'bi-journal-text' },
  ] as const;

  constructor() {
    // Opening the dock loads the events at once (they are only polled while it is open).
    effect(() => {
      if (this.feed.open()) untracked(() => this.feed.refreshNow());
    });
  }
}
