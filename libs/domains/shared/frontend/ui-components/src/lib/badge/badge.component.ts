import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type FpcBadgeVariant = 'badge' | 'info' | 'marketing';

export type FpcBadgeColor = 'primary' | 'secondary' | 'success' | 'danger' | 'warning' | 'info' | 'light' | 'dark';

export type FpcBadgeSize = 'sm' | 'md' | 'lg' | 'xl';

/**
 * `badge` renders the solid Bootstrap badge. `info` is the console metadata chip (former
 * `.info-badge`): compact, tertiary by default, chrome on the host so domain tint classes and
 * hover states cannot reflow list-row borders. Use `size="sm"` to match Bootstrap `btn-sm`
 * control chrome (e.g. top-bar chips beside language switcher).
 *
 * `marketing` is the landing soft chip (border / subtle fill / feature pills). Use `size="xl"` for
 * hero feature rows (larger padding + light shadow). Solid section eyebrows stay on `badge`.
 *
 * Host classes are additive (not a full `[class]` rewrite) so callers can attach tint modifiers
 * like `tickets-board__chip--status-todo` or layout hooks like `bento-badge`.
 */
@Component({
  selector: 'fpc-badge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'fpc-badge',
    '[class.fpc-badge--info]': 'isInfo()',
    '[class.fpc-badge--solid]': 'isSolid()',
    '[class.fpc-badge--marketing]': 'isMarketing()',
    '[class.fpc-badge--sm]': 'size() === "sm"',
    '[class.fpc-badge--md]': 'size() === "md"',
    '[class.fpc-badge--lg]': 'size() === "lg"',
    '[class.fpc-badge--xl]': 'size() === "xl"',
    '[class.fpc-badge--primary]': 'color() === "primary"',
    '[class.fpc-badge--secondary]': 'color() === "secondary"',
    '[class.fpc-badge--success]': 'color() === "success"',
    '[class.fpc-badge--danger]': 'color() === "danger"',
    '[class.fpc-badge--warning]': 'color() === "warning"',
    '[class.fpc-badge--info-color]': 'color() === "info"',
    '[class.fpc-badge--light]': 'color() === "light"',
    '[class.fpc-badge--dark]': 'color() === "dark"',
    '[class.badge]': 'isSolid()',
    '[class.text-bg-primary]': 'isSolid() && color() === "primary"',
    '[class.text-bg-secondary]': 'isSolid() && color() === "secondary"',
    '[class.text-bg-success]': 'isSolid() && color() === "success"',
    '[class.text-bg-danger]': 'isSolid() && color() === "danger"',
    '[class.text-bg-warning]': 'isSolid() && color() === "warning"',
    '[class.text-bg-info]': 'isSolid() && color() === "info"',
    '[class.text-bg-light]': 'isSolid() && color() === "light"',
    '[class.text-bg-dark]': 'isSolid() && color() === "dark"',
    '[class.rounded-pill]': 'pill()',
  },
  template: `<ng-content />`,
  styleUrl: './badge.component.scss',
})
export class FpcBadgeComponent {
  readonly variant = input<FpcBadgeVariant>('badge');
  readonly color = input<FpcBadgeColor>('primary');
  readonly size = input<FpcBadgeSize>('md');
  readonly pill = input(false);

  protected readonly isInfo = computed(() => this.variant() === 'info');
  protected readonly isSolid = computed(() => this.variant() === 'badge');
  protected readonly isMarketing = computed(() => this.variant() === 'marketing');
}
