import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type FpcIconSize = 'inherit' | 'sm' | 'md' | 'lg' | 'xl';

/**
 * Thin wrapper around Bootstrap Icons. Pass the icon name without the `bi-` prefix
 * (for example `name="check-lg"` renders `<i class="bi bi-check-lg">`).
 */
@Component({
  selector: 'fpc-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': '"fpc-icon fpc-icon--" + size()',
  },
  template: `
    <i
      [class]="iconClass()"
      [attr.aria-hidden]="decorative() ? 'true' : null"
      [attr.role]="decorative() ? null : 'img'"
      [attr.aria-label]="decorative() ? null : ariaLabel()"
    ></i>
  `,
  styleUrl: './icon.component.scss',
})
export class FpcIconComponent {
  /** Bootstrap icon name without the `bi-` prefix. */
  readonly name = input.required<string>();
  readonly size = input<FpcIconSize>('inherit');
  readonly ariaLabel = input<string | null>(null);
  /** Defaults to `true` so icons stay decorative unless an `ariaLabel` is supplied. */
  readonly ariaHidden = input<boolean | null>(null);

  protected readonly iconClass = computed(() => `bi bi-${this.name()}`);

  protected readonly decorative = computed(() => {
    const explicit = this.ariaHidden();

    if (explicit !== null) {
      return explicit;
    }

    return this.ariaLabel() === null;
  });
}
