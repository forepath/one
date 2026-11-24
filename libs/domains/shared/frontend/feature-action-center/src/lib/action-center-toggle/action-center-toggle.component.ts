import { ChangeDetectionStrategy, Component, LOCALE_ID, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActionCenterFacade } from '@forepath/shared/frontend/data-access-action-center';
import { FpcBadgeComponent, FpcButtonComponent, fpcPlural } from '@forepath/shared/frontend/ui-components';

import { ACTION_CENTER_PANEL_ID } from '../action-center-panel/action-center-panel.component';

/**
 * Top-bar toggle of the action center: a light bulb with the number of open to-dos as a badge.
 */
@Component({
  selector: 'shared-action-center-toggle',
  standalone: true,
  imports: [FpcBadgeComponent, FpcButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <fpc-button
      variant="link"
      size="sm"
      class="fpc-top-bar__action action-center-toggle"
      [class.active]="open()"
      [title]="title()"
      [ariaLabel]="title()"
      [ariaPressed]="open()"
      [ariaControls]="panelId"
      (clicked)="toggle()"
      data-testid="top-bar-action-center"
    >
      <i class="bi" [class.bi-lightbulb]="!open()" [class.bi-lightbulb-fill]="open()" aria-hidden="true"></i>
      @if (count() > 0) {
        <fpc-badge [pill]="true" size="sm" color="primary" data-testid="top-bar-action-center-count">{{
          countText()
        }}</fpc-badge>
      }
    </fpc-button>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
      }

      :host ::ng-deep .action-center-toggle .fpc-button__content {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
      }
    `,
  ],
})
export class ActionCenterToggleComponent {
  private readonly facade = inject(ActionCenterFacade);
  private readonly locale = inject(LOCALE_ID);

  protected readonly panelId = ACTION_CENTER_PANEL_ID;
  protected readonly open = toSignal(this.facade.panelOpen$, { initialValue: false });
  protected readonly count = toSignal(this.facade.openCount$, { initialValue: 0 });
  /** Large numbers stay compact in the bar. */
  protected readonly countText = computed(() => (this.count() > 99 ? '99+' : String(this.count())));
  protected readonly title = computed(() =>
    this.count() > 0
      ? fpcPlural(
          this.count(),
          {
            one: $localize`:@@featureActionCenter-toggleTitleOne:To-dos: {count} open`,
            other: $localize`:@@featureActionCenter-toggleTitleOther:To-dos: {count} open`,
          },
          this.locale,
        )
      : $localize`:@@featureActionCenter-toggleTitleNone:To-dos: nothing open`,
  );

  protected toggle(): void {
    this.facade.togglePanel();
  }
}
