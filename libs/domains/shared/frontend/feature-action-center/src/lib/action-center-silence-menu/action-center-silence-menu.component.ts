import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import type { ActionCenterSilenceAudience } from '@forepath/shared/frontend/data-access-action-center';
import {
  FpcButtonComponent,
  FpcDropdownComponent,
  FpcDropdownItemComponent,
} from '@forepath/shared/frontend/ui-components';

/** A silence choice: who it applies to and for how long (`null` = until removed). */
export interface ActionCenterSilenceChoice {
  audience: ActionCenterSilenceAudience;
  durationMs: number | null;
}

const DAY_MS = 86_400_000;

/**
 * Bell-slash menu of a stack or item: silence for oneself (until removed, a day, a week) and, for admins, for
 * everyone.
 */
@Component({
  selector: 'shared-action-center-silence-menu',
  standalone: true,
  imports: [FpcButtonComponent, FpcDropdownComponent, FpcDropdownItemComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <fpc-dropdown [(open)]="open" alignment="end" appendTo="body" [disabled]="disabled()">
      <fpc-button
        fpcDropdownTrigger
        variant="link"
        size="sm"
        iconOnly
        [title]="label()"
        [ariaLabel]="label()"
        ariaHaspopup="menu"
        [ariaExpanded]="open()"
        [disabled]="disabled()"
        data-testid="action-center-silence-trigger"
      >
        <i class="bi bi-bell-slash" aria-hidden="true"></i>
      </fpc-button>
      <fpc-dropdown-item
        icon="bell-slash"
        (selected)="choose('self', null)"
        data-testid="action-center-silence-self"
        i18n="@@featureActionCenter-silenceForMe"
        >Silence for me</fpc-dropdown-item
      >
      <fpc-dropdown-item
        icon="clock"
        (selected)="choose('self', dayMs)"
        data-testid="action-center-snooze-day"
        i18n="@@featureActionCenter-snoozeDay"
        >Snooze for 1 day</fpc-dropdown-item
      >
      <fpc-dropdown-item
        icon="calendar-week"
        (selected)="choose('self', 7 * dayMs)"
        data-testid="action-center-snooze-week"
        i18n="@@featureActionCenter-snoozeWeek"
        >Snooze for 1 week</fpc-dropdown-item
      >
      @if (canSilenceForEveryone()) {
        <div class="dropdown-divider"></div>
        <fpc-dropdown-item
          icon="people"
          (selected)="choose('everyone', null)"
          data-testid="action-center-silence-everyone"
          i18n="@@featureActionCenter-silenceForEveryone"
          >Silence for everyone</fpc-dropdown-item
        >
      }
    </fpc-dropdown>
  `,
})
export class ActionCenterSilenceMenuComponent {
  readonly label = input.required<string>();
  readonly canSilenceForEveryone = input(false);
  readonly disabled = input(false);
  readonly silence = output<ActionCenterSilenceChoice>();

  protected readonly open = signal(false);
  protected readonly dayMs = DAY_MS;

  protected choose(audience: ActionCenterSilenceAudience, durationMs: number | null): void {
    this.open.set(false);
    this.silence.emit({ audience, durationMs });
  }
}
