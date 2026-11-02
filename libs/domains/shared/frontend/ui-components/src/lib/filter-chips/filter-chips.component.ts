import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/** One active filter, e.g. parsed from `kind:VirtualMachine` or `-status:ready` in a search field. */
export interface FpcFilterChip {
  /** Stable key, used for tracking and returned on removal. */
  id: string;
  /** Field name (`kind`); omitted for free-text terms. */
  field?: string;
  value: string;
  /** `-field:value`: excludes matches. */
  negated?: boolean;
  /** Display text; defaults to `field:value` (with a leading `−` when negated). */
  label?: string;
}

export function fpcFilterChipText(chip: FpcFilterChip): string {
  if (chip.label) return chip.label;

  const body = chip.field ? `${chip.field}:${chip.value}` : chip.value;

  return chip.negated ? `−${body}` : body;
}

/**
 * Active `field:value` filters as removable chips (below or inside a toolbar). Presentational:
 * the consumer parses the query and rewrites it when a chip is removed.
 */
@Component({
  selector: 'fpc-filter-chips',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'fpc-filter-chips' },
  template: `
    @if (chips().length > 0) {
      <ul class="fpc-filter-chips__list list-unstyled mb-0" [attr.aria-label]="ariaLabel()">
        @for (chip of chips(); track chip.id) {
          <li
            class="fpc-filter-chips__chip badge rounded-pill"
            [class.fpc-filter-chips__chip--negated]="chip.negated"
            data-testid="fpc-filter-chip"
          >
            <span class="fpc-filter-chips__text">{{ text(chip) }}</span>
            <button
              type="button"
              class="fpc-filter-chips__remove btn-close btn-close-sm"
              [attr.aria-label]="removeLabel() + ' ' + text(chip)"
              (click)="removeChip.emit(chip)"
            ></button>
          </li>
        }
        @if (chips().length > 1 && clearLabel()) {
          <li>
            <button
              type="button"
              class="btn btn-link btn-sm p-0 fpc-filter-chips__clear"
              data-testid="fpc-filter-chips-clear"
              (click)="clearAll.emit()"
            >
              {{ clearLabel() }}
            </button>
          </li>
        }
      </ul>
    }
  `,
  styleUrl: './filter-chips.component.scss',
})
export class FpcFilterChipsComponent {
  readonly chips = input<readonly FpcFilterChip[]>([]);
  readonly ariaLabel = input('Active filters');
  readonly removeLabel = input('Remove filter');
  /** Text of the "clear all" link shown with two or more chips; empty hides it. */
  readonly clearLabel = input('Clear all');

  readonly removeChip = output<FpcFilterChip>();
  readonly clearAll = output<void>();

  protected text(chip: FpcFilterChip): string {
    return fpcFilterChipText(chip);
  }
}
