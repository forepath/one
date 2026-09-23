import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type FpcButtonGroupSize = 'sm' | 'md' | 'lg';

export type FpcButtonGroupGap = 'xs' | 'sm' | 'md' | 'lg';

/**
 * Toolbar cluster for related `fpc-button`s. Unlike Bootstrap `btn-group`, buttons stay visually
 * separate with a small gap (no shared borders / collapsed radii).
 *
 * - `size` sets the default gap scale (`sm` → tight toolbars, `lg` → roomier clusters).
 * - `gap` overrides that scale when a one-off spacing is needed.
 *
 * Put `role="group"` / `aria-label` on the host via the inputs; keep `fpcListItemActions` (and
 * similar slot markers) on this host when the whole group is the projected slot.
 */
@Component({
  selector: 'fpc-button-group',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'fpc-button-group',
    role: 'group',
    '[class.fpc-button-group--sm]': 'size() === "sm"',
    '[class.fpc-button-group--md]': 'size() === "md"',
    '[class.fpc-button-group--lg]': 'size() === "lg"',
    '[class.fpc-button-group--gap-xs]': 'resolvedGap() === "xs"',
    '[class.fpc-button-group--gap-sm]': 'resolvedGap() === "sm"',
    '[class.fpc-button-group--gap-md]': 'resolvedGap() === "md"',
    '[class.fpc-button-group--gap-lg]': 'resolvedGap() === "lg"',
    '[attr.aria-label]': 'ariaLabel()',
  },
  template: `<ng-content />`,
  styleUrl: './button-group.component.scss',
})
export class FpcButtonGroupComponent {
  /** Semantic size of the cluster; also picks the default gap. */
  readonly size = input<FpcButtonGroupSize>('md');
  /** Optional gap override (`xs` = 0.125rem … `lg` = 0.5rem). */
  readonly gap = input<FpcButtonGroupGap | null>(null);
  readonly ariaLabel = input<string | null>(null);

  protected readonly resolvedGap = computed<FpcButtonGroupGap>(() => {
    const override = this.gap();

    if (override) {
      return override;
    }

    switch (this.size()) {
      case 'sm':
        return 'xs';
      case 'lg':
        return 'md';
      default:
        return 'sm';
    }
  });
}
