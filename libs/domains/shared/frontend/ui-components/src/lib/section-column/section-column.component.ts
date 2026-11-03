import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type FpcSectionColumnVariant = 'default' | 'marketing' | 'form';

/**
 * One page column inside `fpc-section-row`. Use `variant="marketing"` / `variant="form"` for
 * auth-style split layouts; `scroll` makes the column its own vertical scroll area.
 */
@Component({
  selector: 'fpc-section-column',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'section__column fpc-section-column',
    '[class.section__column--scroll]': 'scroll()',
    '[class.section__column--marketing]': 'variant() === "marketing"',
    '[class.section__column--form]': 'variant() === "form"',
    // A style map, not `[style.flex]`: a null `flex` binding removes the shorthand and with it a consumer's own
    // `[style.flex-basis]` (the knowledge tree's resizable sidebar collapsed to 1 px).
    '[style]': 'growStyle()',
  },
  template: `
    @if (title()) {
      <h2 class="section__column-title">{{ title() }}</h2>
    }
    <ng-content />
  `,
  styleUrl: './section-column.component.scss',
})
export class FpcSectionColumnComponent {
  /** Turns the column into its own vertical scroll area. */
  readonly scroll = input(false);
  /** Auth / marketing split layouts. */
  readonly variant = input<FpcSectionColumnVariant>('default');
  /** Optional column heading rendered above projected content. */
  readonly title = input<string | null>(null);
  /** Raw `flex` shorthand override, for example `0 0 320px` for a fixed sidebar column. */
  readonly grow = input<string | null>(null);

  protected readonly growStyle = computed(() => {
    const grow = this.grow();

    return grow === null ? null : { flex: grow };
  });
}
