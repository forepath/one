import { ChangeDetectionStrategy, Component, inject, InjectionToken, input, model, output } from '@angular/core';

export type FpcAccordionItemVariant = 'default' | 'condensed';

let nextAccordionItemId = 0;

/**
 * Contract `fpc-accordion` implements so items can announce that they were opened without
 * importing the parent component (which would create a circular module dependency).
 */
export interface FpcAccordionHost {
  notifyItemOpened(item: FpcAccordionItemComponent): void;
}

export const FPC_ACCORDION_HOST = new InjectionToken<FpcAccordionHost>('FPC_ACCORDION_HOST');

/** One expandable section inside `fpc-accordion`. */
@Component({
  selector: 'fpc-accordion-item',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'accordion-item fpc-accordion-item',
    '[class.fpc-accordion-item--condensed]': 'variant() === "condensed"',
  },
  template: `
    <h2 class="accordion-header">
      <button
        type="button"
        class="accordion-button fpc-accordion-item__button"
        [class.collapsed]="!open()"
        [disabled]="disabled()"
        [attr.aria-expanded]="open()"
        [attr.aria-controls]="bodyId"
        (click)="toggle()"
      >
        @if (icon()) {
          <i class="bi bi-{{ icon() }}" aria-hidden="true"></i>
        }
        <span class="fpc-accordion-item__heading">{{ heading() }}</span>
        <ng-content select="[fpcAccordionItemHeading]" />
      </button>
    </h2>

    <div class="accordion-collapse collapse" [class.show]="open()" [id]="bodyId" role="region">
      <div class="accordion-body">
        <ng-content />
      </div>
    </div>
  `,
  styleUrl: './accordion-item.component.scss',
})
export class FpcAccordionItemComponent {
  private readonly accordion = inject(FPC_ACCORDION_HOST, { optional: true });

  readonly heading = input('');
  readonly icon = input<string | null>(null);
  readonly open = model(false);
  readonly disabled = input(false);
  /** `condensed` matches dense list rows (e.g. workspace search file headers). */
  readonly variant = input<FpcAccordionItemVariant>('default');

  readonly toggled = output<boolean>();

  protected readonly bodyId = `fpc-accordion-body-${nextAccordionItemId++}`;

  toggle(): void {
    if (this.disabled()) {
      return;
    }

    const next = !this.open();

    this.open.set(next);
    this.toggled.emit(next);

    if (next) {
      this.accordion?.notifyItemOpened(this);
    }
  }
}
