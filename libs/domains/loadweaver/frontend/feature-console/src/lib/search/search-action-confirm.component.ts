import { Component, inject, model } from '@angular/core';
import { ConsoleSearchFacade, type SearchAction } from '@forepath/loadweaver/frontend/data-access-console';
import { FpcConfirmDialogComponent } from '@forepath/shared/frontend/ui-components';

import { searchActionRequest } from './search-format';

/** Confirms an `api` action of the search (method and path shown) before it runs. */
@Component({
  selector: 'loadweaver-search-action-confirm',
  imports: [FpcConfirmDialogComponent],
  template: `
    <fpc-confirm-dialog
      [open]="action() !== null"
      (openChange)="onOpenChange($event)"
      [title]="title"
      [message]="action()?.title ?? null"
      [confirmLabel]="confirmLabel"
      [cancelLabel]="cancelLabel"
      [warning]="true"
      (confirmed)="confirm()"
    >
      <p class="small text-body-secondary mt-2 mb-1">{{ callsLabel }}</p>
      <code class="d-block" data-testid="search-action-request">{{ request() }}</code>
    </fpc-confirm-dialog>
  `,
  standalone: true,
})
export class LoadweaverSearchActionConfirmComponent {
  private readonly facade = inject(ConsoleSearchFacade);

  /** The action to confirm; null closes the dialog. */
  readonly action = model<SearchAction | null>(null);

  readonly title = $localize`:@@lwConsoleSearch-confirmTitle:Run this action?`;
  readonly callsLabel = $localize`:@@lwConsoleSearch-confirmCalls:This calls the control-plane API:`;
  readonly confirmLabel = $localize`:@@lwConsoleSearch-confirmRun:Run`;
  readonly cancelLabel = $localize`:@@lwConsoleSearch-confirmCancel:Cancel`;

  request(): string {
    const action = this.action();

    return action ? searchActionRequest(action) : '';
  }

  confirm(): void {
    const action = this.action();

    if (action) this.facade.runAction(action);

    this.action.set(null);
  }

  onOpenChange(open: boolean): void {
    if (!open) this.action.set(null);
  }
}
