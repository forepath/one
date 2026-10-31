import {
  ChangeDetectionStrategy,
  Component,
  Directive,
  TemplateRef,
  computed,
  contentChildren,
  inject,
  input,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';

/** One fact of `fpc-key-value-list`. */
export interface FpcKeyValueItem {
  /** Stable key; also selects a `*fpcKeyValue="key"` template for a rich value. */
  key: string;
  label: string;
  value?: string | number | boolean | null;
  /** Monospace value (ids, addresses, digests). */
  mono?: boolean;
  /** Muted text under the value. */
  hint?: string | null;
}

/** Rich value for the item with the same `key`: `<ng-template fpcKeyValue="status">…</ng-template>`. */
@Directive({ selector: 'ng-template[fpcKeyValue]', standalone: true })
export class FpcKeyValueDirective {
  readonly key = input.required<string>({ alias: 'fpcKeyValue' });
  readonly template = inject(TemplateRef);
}

/**
 * Label / value facts (Summary tabs, inspectors): a `<dl>` grid with one or two columns. Empty values
 * show `emptyText`. Density follows the app (`body.fpc-density-compact` tightens the rows).
 */
@Component({
  selector: 'fpc-key-value-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet],
  host: {
    class: 'fpc-key-value-list',
    '[class.fpc-key-value-list--two]': 'columns() === 2',
  },
  template: `
    <dl class="fpc-key-value-list__list mb-0">
      @for (item of items(); track item.key) {
        <div class="fpc-key-value-list__row" [attr.data-key]="item.key">
          <dt class="fpc-key-value-list__label text-body-secondary">{{ item.label }}</dt>
          <dd class="fpc-key-value-list__value mb-0" [class.font-monospace]="item.mono">
            @if (templates().get(item.key); as template) {
              <ng-container *ngTemplateOutlet="template; context: { $implicit: item }" />
            } @else if (item.value === null || item.value === undefined || item.value === '') {
              <span class="text-body-secondary">{{ emptyText() }}</span>
            } @else {
              {{ item.value }}
            }
            @if (item.hint) {
              <div class="small text-body-secondary">{{ item.hint }}</div>
            }
          </dd>
        </div>
      }
    </dl>
  `,
  styleUrl: './key-value-list.component.scss',
})
export class FpcKeyValueListComponent {
  readonly items = input<readonly FpcKeyValueItem[]>([]);
  readonly columns = input<1 | 2>(1);
  readonly emptyText = input('—');

  private readonly valueTemplates = contentChildren(FpcKeyValueDirective);
  protected readonly templates = computed(
    () => new Map(this.valueTemplates().map((directive) => [directive.key(), directive.template] as const)),
  );
}
