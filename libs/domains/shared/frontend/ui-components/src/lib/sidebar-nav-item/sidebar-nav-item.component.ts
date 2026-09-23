import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import {
  FpcNotificationIndicatorComponent,
  FpcNotificationIndicatorKind,
} from '../notification-indicator/notification-indicator.component';

/**
 * Tile inside `fpc-sidebar`. Renders an anchor when `href` is set and a button otherwise, so
 * routing stays with the consuming app (the library deliberately does not depend on
 * `@angular/router`).
 */
@Component({
  selector: 'fpc-sidebar-nav-item',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FpcNotificationIndicatorComponent],
  host: { class: 'fpc-sidebar-nav-item' },
  template: `
    @if (href() !== null) {
      <a
        class="sidebar__item fpc-sidebar-nav-item__tile position-relative"
        [class.active]="active()"
        [attr.href]="href()"
        [attr.title]="title() ?? label()"
        [attr.aria-current]="active() ? 'page' : null"
        (click)="selected.emit()"
      >
        <i class="bi bi-{{ icon() }}" aria-hidden="true"></i>
        <span class="small">{{ label() }}</span>
        @if (badge() !== null) {
          <fpc-notification-indicator [kind]="badge()!" placement="absolute" [ariaLabel]="badgeAriaLabel()" />
        }
      </a>
    } @else {
      <button
        type="button"
        class="sidebar__item fpc-sidebar-nav-item__tile position-relative"
        [class.active]="active()"
        [disabled]="disabled()"
        [attr.title]="title() ?? label()"
        [attr.aria-current]="active() ? 'page' : null"
        (click)="selected.emit()"
      >
        <i class="bi bi-{{ icon() }}" aria-hidden="true"></i>
        <span class="small">{{ label() }}</span>
        @if (badge() !== null) {
          <fpc-notification-indicator [kind]="badge()!" placement="absolute" [ariaLabel]="badgeAriaLabel()" />
        }
      </button>
    }
  `,
  styleUrl: './sidebar-nav-item.component.scss',
})
export class FpcSidebarNavItemComponent {
  /** Bootstrap icon name without the `bi-` prefix. */
  readonly icon = input.required<string>();
  readonly label = input('');
  readonly active = input(false);
  readonly disabled = input(false);
  readonly href = input<string | null>(null);
  /** Tooltip text; defaults to `label`. */
  readonly title = input<string | null>(null);
  readonly badge = input<FpcNotificationIndicatorKind | null>(null);
  readonly badgeAriaLabel = input<string | null>(null);

  readonly selected = output<void>();
}
