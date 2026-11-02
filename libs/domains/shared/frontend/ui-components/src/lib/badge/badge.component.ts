import { ChangeDetectionStrategy, Component, booleanAttribute, computed, input } from '@angular/core';

export type FpcBadgeVariant = 'badge' | 'info' | 'marketing';

export type FpcBadgeColor = 'primary' | 'secondary' | 'success' | 'danger' | 'warning' | 'info' | 'light' | 'dark';

export type FpcBadgeSize = 'sm' | 'md' | 'lg' | 'xl';

/** Object-state tone (3.38 R10): the shared tinted text badge (24 % fill + `*-text-emphasis`). */
export type FpcBadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'primary' | 'dark';

const TONE_COLOR: Record<FpcBadgeTone, FpcBadgeColor> = {
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  info: 'info',
  neutral: 'secondary',
  primary: 'primary',
  /** Rare emphasis tone (e.g. AI-generated content markers in Agenstra). */
  dark: 'dark',
};

/**
 * `badge` renders the solid Bootstrap badge. `info` is the console metadata chip (former
 * `.info-badge`): compact, tertiary by default, chrome on the host so domain tint classes and
 * hover states cannot reflow list-row borders. Use `size="sm"` to match Bootstrap `btn-sm`
 * control chrome (e.g. top-bar chips beside language switcher).
 *
 * `marketing` is the landing soft chip (border / subtle fill / feature pills). Use `size="xl"` for
 * hero feature rows (light shadow). Marketing chips share the button padding. Solid section eyebrows stay on `badge`.
 *
 * `tone` is the one way to show an **object state** (plan, task, backup, alert, release …; 3.38 R10): a tinted
 * text badge in the Agenstra / Decabill look (`success|warning|danger|info|neutral|primary`, rare `dark`), sentence-case
 * translated label. It wins over `variant` / `color`. Health glyphs use `fpc-status-badge` instead.
 *
 * `icon` adds a leading Bootstrap icon (`check-circle`, without `bi-`). `iconOnly` (3.38 D7) renders just the icon in a
 * **square** badge at the badge height (like icon-only buttons); `label` (the human-readable value) becomes `title` +
 * `aria-label` and the projected text is dropped.
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
    '[class.fpc-badge--primary]': 'resolvedColor() === "primary"',
    '[class.fpc-badge--secondary]': 'resolvedColor() === "secondary"',
    '[class.fpc-badge--success]': 'resolvedColor() === "success"',
    '[class.fpc-badge--danger]': 'resolvedColor() === "danger"',
    '[class.fpc-badge--warning]': 'resolvedColor() === "warning"',
    '[class.fpc-badge--info-color]': 'resolvedColor() === "info"',
    '[class.fpc-badge--light]': 'resolvedColor() === "light"',
    '[class.fpc-badge--dark]': 'resolvedColor() === "dark"',
    '[class.badge]': 'isSolid()',
    '[class.text-bg-primary]': 'isSolid() && resolvedColor() === "primary"',
    '[class.text-bg-secondary]': 'isSolid() && resolvedColor() === "secondary"',
    '[class.text-bg-success]': 'isSolid() && resolvedColor() === "success"',
    '[class.text-bg-danger]': 'isSolid() && resolvedColor() === "danger"',
    '[class.text-bg-warning]': 'isSolid() && resolvedColor() === "warning"',
    '[class.text-bg-info]': 'isSolid() && resolvedColor() === "info"',
    '[class.text-bg-light]': 'isSolid() && resolvedColor() === "light"',
    '[class.text-bg-dark]': 'isSolid() && resolvedColor() === "dark"',
    '[class.rounded-pill]': 'pill()',
    '[class.fpc-badge--tone]': '!!tone()',
    '[class.fpc-badge--icon-only]': 'iconOnly() && !!icon()',
    '[attr.title]': 'label()',
    '[attr.aria-label]': 'iconOnly() && icon() ? label() : null',
    '[attr.role]': 'iconOnly() && icon() ? "img" : null',
  },
  template: `@if (icon(); as glyph) {
      <i class="bi fpc-badge__icon" [class]="'bi-' + glyph" aria-hidden="true"></i>
    }
    @if (!iconOnly() || !icon()) {
      <ng-content />
    }`,
  styleUrl: './badge.component.scss',
})
export class FpcBadgeComponent {
  readonly variant = input<FpcBadgeVariant>('badge');
  readonly color = input<FpcBadgeColor>('primary');
  readonly size = input<FpcBadgeSize>('md');
  readonly pill = input(false);
  /** Object-state tone (tinted text badge); overrides `variant` / `color`. */
  readonly tone = input<FpcBadgeTone | null>(null);
  /** Leading Bootstrap icon name without the `bi-` prefix. */
  readonly icon = input<string | null>(null);
  /** Square, icon only; `label` becomes title + aria-label (needs `icon`). */
  readonly iconOnly = input(false, { transform: booleanAttribute });
  /** Human-readable value: the tooltip, and the accessible name in `iconOnly` mode. */
  readonly label = input<string | null>(null);

  protected readonly resolvedColor = computed<FpcBadgeColor>(() => {
    const tone = this.tone();

    return tone ? TONE_COLOR[tone] : this.color();
  });

  protected readonly isInfo = computed(() => !this.tone() && this.variant() === 'info');
  protected readonly isSolid = computed(() => !!this.tone() || this.variant() === 'badge');
  protected readonly isMarketing = computed(() => !this.tone() && this.variant() === 'marketing');
}
