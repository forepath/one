import { ChangeDetectionStrategy, Component, input, model, output } from '@angular/core';

import { FpcSearchFieldComponent } from '../search-field/search-field.component';

/**
 * Search field stacked on top of a scrollable list body. Filtering stays with the consumer;
 * this component only owns the layout and the query binding.
 */
@Component({
  selector: 'fpc-list-search',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FpcSearchFieldComponent],
  host: { class: 'fpc-list-search' },
  template: `
    <div class="fpc-list-search__search">
      <fpc-search-field
        [value]="query()"
        [placeholder]="placeholder()"
        [ariaLabel]="ariaLabel()"
        [disabled]="disabled()"
        [bordered]="bordered()"
        (valueChange)="query.set($event)"
        (cleared)="cleared.emit()"
      />
    </div>

    <div class="fpc-list-search__body">
      <ng-content />
    </div>

    <div class="fpc-list-search__footer">
      <ng-content select="[fpcListSearchFooter]" />
    </div>
  `,
  styleUrl: './list-search.component.scss',
})
export class FpcListSearchComponent {
  readonly query = model('');
  readonly placeholder = input<string | null>('Search');
  readonly ariaLabel = input<string | null>('Search');
  readonly disabled = input(false);
  readonly bordered = input(false);

  readonly cleared = output<void>();
}
