import { ChangeDetectionStrategy, Component, contentChildren, forwardRef, input } from '@angular/core';

import {
  FPC_ACCORDION_HOST,
  FpcAccordionHost,
  FpcAccordionItemComponent,
} from '../accordion-item/accordion-item.component';

/** Bootstrap accordion host. Project `fpc-accordion-item` children. */
@Component({
  selector: 'fpc-accordion',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'accordion fpc-accordion',
    '[class.accordion-flush]': 'flush()',
  },
  providers: [
    {
      provide: FPC_ACCORDION_HOST,
      useExisting: forwardRef(() => FpcAccordionComponent),
    },
  ],
  template: `<ng-content />`,
  styleUrl: './accordion.component.scss',
})
export class FpcAccordionComponent implements FpcAccordionHost {
  /** Allows several items to stay open at the same time. */
  readonly multi = input(false);
  readonly flush = input(false);

  private readonly items = contentChildren(FpcAccordionItemComponent);

  notifyItemOpened(openedItem: FpcAccordionItemComponent): void {
    if (this.multi()) {
      return;
    }

    this.items()
      .filter((item) => item !== openedItem)
      .forEach((item) => item.open.set(false));
  }
}
