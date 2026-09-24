import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type FpcStatusBadgeTone =
  | 'primary'
  | 'secondary'
  | 'success'
  | 'danger'
  | 'warning'
  | 'info'
  | 'light'
  | 'dark'
  | 'neutral';

export type FpcStatusBadgeSize = 'sm' | 'md' | 'lg';

/**
 * Circular icon well. Projects any content (usually a `fpc-icon` or a single character) and
 * centres it inside a tinted circle.
 */
@Component({
  selector: 'fpc-status-badge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': '"fpc-status-badge fpc-status-badge--" + tone() + " fpc-status-badge--" + size()',
    '[attr.role]': 'ariaLabel() ? "img" : null',
    '[attr.aria-label]': 'ariaLabel()',
    '[attr.aria-hidden]': 'ariaLabel() ? null : "true"',
  },
  template: `<ng-content />`,
  styleUrl: './status-badge.component.scss',
})
export class FpcStatusBadgeComponent {
  readonly tone = input<FpcStatusBadgeTone>('primary');
  readonly size = input<FpcStatusBadgeSize>('md');
  readonly ariaLabel = input<string | null>(null);
}
