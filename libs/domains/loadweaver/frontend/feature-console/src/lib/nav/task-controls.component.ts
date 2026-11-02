import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { FpcButtonComponent, FpcConfirmDialogComponent } from '@forepath/shared/frontend/ui-components';

import { ConsoleTaskFeedService } from './task-feed.service';
import type { TaskControl, TaskEntry } from './tasks';

/**
 * The controls of one task (3.37 P4 / gap closure): Cancel / Pause / Resume through `ConsoleTaskFeedService.control()`;
 * controls flagged `confirm` (cancel) ask first. Shared by the task dock and Activity › Tasks so both behave the same.
 */
@Component({
  selector: 'loadweaver-task-controls',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FpcButtonComponent, FpcConfirmDialogComponent],
  host: { class: 'd-inline-flex align-items-center gap-1' },
  template: `
    @for (c of task().controls ?? []; track c.action) {
      <fpc-button
        size="sm"
        iconOnly
        [variant]="c.confirm ? 'danger' : 'secondary'"
        [ariaLabel]="c.label + ': ' + task().title"
        [title]="c.label"
        [loading]="feed.controlling() === task().id"
        (clicked)="run(c)"
        [attr.data-testid]="'task-control-' + c.action"
      >
        <i class="bi {{ c.icon }}" aria-hidden="true"></i>
      </fpc-button>
    }
    @if (pending(); as control) {
      <fpc-confirm-dialog
        [open]="true"
        (openChange)="$event || pending.set(null)"
        [title]="confirmTitle"
        [message]="task().title"
        [confirmLabel]="control.label"
        [cancelLabel]="keepLabel"
        [danger]="true"
        (confirmed)="confirm()"
      />
    }
  `,
})
export class LoadweaverTaskControlsComponent {
  readonly feed = inject(ConsoleTaskFeedService);

  readonly task = input.required<TaskEntry>();
  /** A control waiting for its confirmation (cancel). */
  readonly pending = signal<TaskControl | null>(null);
  readonly confirmTitle = $localize`:@@lwConsoleDock-cancelTitle:Cancel this task?`;
  readonly keepLabel = $localize`:@@lwConsoleDock-keepRunning:Keep running`;

  run(control: TaskControl): void {
    if (control.confirm) this.pending.set(control);
    else this.feed.control(this.task(), control);
  }

  confirm(): void {
    const control = this.pending();

    this.pending.set(null);

    if (control) this.feed.control(this.task(), control);
  }
}
