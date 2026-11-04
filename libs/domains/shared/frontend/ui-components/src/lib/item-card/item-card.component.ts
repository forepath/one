import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { FpcListHeaderComponent } from '../list-header/list-header.component';

/**
 * One editable entry of a repeated form group (e.g. an invoice / offer line item): a bordered,
 * rounded box whose header is an edge-to-edge, non-sticky `fpc-list-header` and whose body is
 * padded. Without a `title` the box has no header row.
 *
 * Slots:
 * - default - the entry's fields (and e.g. its totals summary)
 * - `[fpcItemCardTitle]` - rich content after the title (badges, hints)
 * - `[fpcItemCardActions]` - trailing header controls (e.g. a remove button)
 */
@Component({
  selector: 'fpc-item-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FpcListHeaderComponent],
  host: { class: 'fpc-item-card' },
  template: `
    @if (title()) {
      <fpc-list-header class="fpc-item-card__header" [title]="title()" [sticky]="false">
        <ng-container ngProjectAs="[fpcListHeaderTitle]"><ng-content select="[fpcItemCardTitle]" /></ng-container>
        <ng-container ngProjectAs="[fpcListHeaderActions]"><ng-content select="[fpcItemCardActions]" /></ng-container>
      </fpc-list-header>
    }
    <div class="fpc-item-card__body"><ng-content /></div>
  `,
  styleUrl: './item-card.component.scss',
})
export class FpcItemCardComponent {
  readonly title = input('');
}
