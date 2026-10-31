import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  contentChild,
  Directive,
  ElementRef,
  inject,
  Injector,
  afterNextRender,
  input,
  model,
  output,
  signal,
  TemplateRef,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';

/** Texts of `fpc-list-editor` (English defaults; consumers pass localized ones). `{label}` = the item's label. */
export interface FpcListEditorLabels {
  add: string;
  remove: string;
  moveUp: string;
  moveDown: string;
  empty: string;
  /** Live-region announcements. */
  added: string;
  removed: string;
  moved: string;
}

export const FPC_LIST_EDITOR_DEFAULT_LABELS: FpcListEditorLabels = {
  add: 'Add',
  remove: 'Remove {label}',
  moveUp: 'Move {label} up',
  moveDown: 'Move {label} down',
  empty: 'No entries yet.',
  added: '{label} added',
  removed: '{label} removed',
  moved: '{label} moved',
};

/** Context of the row template: the item, its index and position flags. */
export interface FpcListEditorItemContext<T> {
  $implicit: T;
  index: number;
  first: boolean;
  last: boolean;
  label: string;
}

/** The row template of `fpc-list-editor` (`<ng-template fpcListEditorItem let-item let-i="index">`). */
@Directive({ selector: 'ng-template[fpcListEditorItem]', standalone: true })
export class FpcListEditorItemDirective<T = unknown> {
  readonly template = inject<TemplateRef<FpcListEditorItemContext<T>>>(TemplateRef);

  static ngTemplateContextGuard<T>(
    _dir: FpcListEditorItemDirective<T>,
    ctx: unknown,
  ): ctx is FpcListEditorItemContext<T> {
    return true;
  }
}

/** A copy of `items` with the entry at `from` moved to `to` (out-of-range moves return the list unchanged). */
export function fpcListMove<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];

  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) return next;

  const [item] = next.splice(from, 1);

  next.splice(to, 0, item);

  return next;
}

/** A copy of `items` without the entry at `index`. */
export function fpcListRemove<T>(items: readonly T[], index: number): T[] {
  return items.filter((_, i) => i !== index);
}

function fill(text: string, label: string): string {
  return text.replace('{label}', label);
}

let nextListEditorId = 0;

/**
 * Generic list / array editor (2026-10-29): rows of any content (the `fpcListEditorItem` template) with add, remove
 * and move up / down; `min` / `max` bound the count (Remove / Add disable). Two layouts: `layout="card"` (default; a
 * bordered row with a title line, for objects with several fields) and `layout="inline"` (one line, for scalars).
 *
 * Controlled through `[(items)]`; Add appends `newItem()` (a factory, so every row gets its own object). The `add`,
 * `remove` and `move` outputs fire as well. Accessible: a labelled group with a list, buttons named after the row
 * (`itemLabel`), focus kept on the moved row's button / the next row after a removal, and a polite live region.
 */
@Component({
  selector: 'fpc-list-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet],
  host: {
    class: 'fpc-list-editor',
    role: 'group',
    '[attr.aria-labelledby]': 'label() ? headingId : null',
    '[attr.aria-label]': 'label() ? null : ariaLabel()',
    '[class.fpc-list-editor--inline]': "layout() === 'inline'",
  },
  template: `
    @if (label()) {
      <div class="fpc-list-editor__heading">
        <span class="fpc-list-editor__label form-label mb-0" [id]="headingId"
          >{{ label() }}
          @if (required()) {
            <span class="text-danger" aria-hidden="true">*</span>
          }
        </span>
        @if (items().length > 0) {
          <span class="fpc-list-editor__count">{{ items().length }}{{ max() !== null ? ' / ' + max() : '' }}</span>
        }
      </div>
    }
    @if (hint()) {
      <p class="fpc-list-editor__hint form-text mt-0 mb-2">{{ hint() }}</p>
    }
    @if (items().length > 0) {
      <ol class="fpc-list-editor__items list-unstyled mb-0">
        @for (item of items(); track $index; let index = $index, first = $first, last = $last) {
          @let rowLabel = labelOf(item, index);
          <li
            class="fpc-list-editor__item"
            [class.fpc-list-editor__item--card]="layout() === 'card'"
            [attr.aria-label]="rowLabel"
            [attr.data-index]="index"
          >
            @if (layout() === 'card') {
              <div class="fpc-list-editor__item-head">
                <span class="fpc-list-editor__item-title">{{ rowLabel }}</span>
                <ng-container
                  [ngTemplateOutlet]="actions"
                  [ngTemplateOutletContext]="{ index, first, last, rowLabel }"
                />
              </div>
              <div class="fpc-list-editor__item-body">
                @if (itemTemplate(); as row) {
                  <ng-container
                    [ngTemplateOutlet]="row.template"
                    [ngTemplateOutletContext]="{ $implicit: item, index, first, last, label: rowLabel }"
                  />
                }
              </div>
            } @else {
              <div class="fpc-list-editor__item-body">
                @if (itemTemplate(); as row) {
                  <ng-container
                    [ngTemplateOutlet]="row.template"
                    [ngTemplateOutletContext]="{ $implicit: item, index, first, last, label: rowLabel }"
                  />
                }
              </div>
              <ng-container [ngTemplateOutlet]="actions" [ngTemplateOutletContext]="{ index, first, last, rowLabel }" />
            }
          </li>
        }
      </ol>
    } @else if (emptyText()) {
      <p class="fpc-list-editor__empty small text-body-secondary mb-0">{{ emptyText() }}</p>
    }
    @if (!disabled()) {
      <button
        type="button"
        class="btn btn-sm fpc-list-editor__add"
        [disabled]="!canAdd()"
        (click)="addItem()"
        data-testid="fpc-list-editor-add"
      >
        <i class="bi bi-plus-lg me-1" aria-hidden="true"></i>{{ addLabel() ?? text().add }}
      </button>
    }
    <span class="visually-hidden" aria-live="polite">{{ announcement() }}</span>

    <ng-template #actions let-index="index" let-first="first" let-last="last" let-rowLabel="rowLabel">
      @if (!disabled()) {
        <span class="fpc-list-editor__actions">
          @if (reorderable() && items().length > 1) {
            <button
              type="button"
              class="btn btn-sm fpc-list-editor__action"
              [disabled]="first"
              [attr.aria-label]="fill(text().moveUp, rowLabel)"
              [title]="fill(text().moveUp, rowLabel)"
              (click)="moveItem(index, index - 1, 'up')"
              data-testid="fpc-list-editor-up"
            >
              <i class="bi bi-arrow-up" aria-hidden="true"></i>
            </button>
            <button
              type="button"
              class="btn btn-sm fpc-list-editor__action"
              [disabled]="last"
              [attr.aria-label]="fill(text().moveDown, rowLabel)"
              [title]="fill(text().moveDown, rowLabel)"
              (click)="moveItem(index, index + 1, 'down')"
              data-testid="fpc-list-editor-down"
            >
              <i class="bi bi-arrow-down" aria-hidden="true"></i>
            </button>
          }
          <button
            type="button"
            class="btn btn-sm fpc-list-editor__action fpc-list-editor__action--remove"
            [disabled]="!canRemove()"
            [attr.aria-label]="fill(text().remove, rowLabel)"
            [title]="fill(text().remove, rowLabel)"
            (click)="removeItem(index)"
            data-testid="fpc-list-editor-remove"
          >
            <i class="bi bi-x-lg" aria-hidden="true"></i>
          </button>
        </span>
      }
    </ng-template>
  `,
  styleUrl: './list-editor.component.scss',
})
export class FpcListEditorComponent<T = unknown> {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  readonly items = model<readonly T[]>([]);
  /** Factory of a new row (Add); without it Add only emits `add`. */
  readonly newItem = input<(() => T) | null>(null);
  readonly label = input<string | null>(null);
  readonly ariaLabel = input<string | null>(null);
  readonly hint = input<string | null>(null);
  readonly required = input(false, { transform: booleanAttribute });
  /** The row's accessible name / card title, e.g. "Disk 2 · root". */
  readonly itemLabel = input<(item: T, index: number) => string>((_item, index) => `#${index + 1}`);
  readonly addLabel = input<string | null>(null);
  readonly emptyText = input<string | null>(FPC_LIST_EDITOR_DEFAULT_LABELS.empty);
  readonly min = input(0);
  readonly max = input<number | null>(null);
  readonly reorderable = input(true, { transform: booleanAttribute });
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly layout = input<'card' | 'inline'>('card');
  readonly labels = input<Partial<FpcListEditorLabels>>({});

  readonly add = output<void>();
  readonly remove = output<number>();
  readonly move = output<{ from: number; to: number }>();

  protected readonly itemTemplate = contentChild(FpcListEditorItemDirective);
  protected readonly headingId = `fpc-list-editor-${nextListEditorId++}`;
  protected readonly text = computed(() => ({ ...FPC_LIST_EDITOR_DEFAULT_LABELS, ...this.labels() }));
  protected readonly canAdd = computed(() => {
    const max = this.max();

    return max === null || this.items().length < max;
  });
  protected readonly canRemove = computed(() => this.items().length > this.min());
  protected readonly announcement = signal('');
  protected readonly fill = fill;

  protected labelOf(item: T, index: number): string {
    return this.itemLabel()(item, index);
  }

  addItem(): void {
    if (!this.canAdd() || this.disabled()) return;

    const factory = this.newItem();

    if (factory) {
      const next = [...this.items(), factory()];

      this.items.set(next);
      this.announcement.set(fill(this.text().added, this.labelOf(next[next.length - 1], next.length - 1)));
      // Focus the new row's first control.
      this.focusAfterRender(next.length - 1, 'input, select, textarea, button:not(.fpc-list-editor__action)');
    }

    this.add.emit();
  }

  removeItem(index: number): void {
    if (!this.canRemove() || this.disabled()) return;

    const label = this.labelOf(this.items()[index], index);

    this.items.set(fpcListRemove(this.items(), index));
    this.announcement.set(fill(this.text().removed, label));
    this.remove.emit(index);

    const remaining = this.items().length;

    if (remaining > 0) this.focusAfterRender(Math.min(index, remaining - 1), '.fpc-list-editor__action--remove');
    else
      afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>('.fpc-list-editor__add')?.focus(), {
        injector: this.injector,
      });
  }

  moveItem(from: number, to: number, direction: 'up' | 'down'): void {
    if (to < 0 || to >= this.items().length || this.disabled()) return;

    const label = this.labelOf(this.items()[from], from);

    this.items.set(fpcListMove(this.items(), from, to));
    this.announcement.set(fill(this.text().moved, label));
    this.move.emit({ from, to });

    const other = direction === 'up' ? 'down' : 'up';

    this.focusAfterRender(
      to,
      `[data-testid="fpc-list-editor-${direction}"]:not(:disabled)`,
      `[data-testid="fpc-list-editor-${other}"]`,
    );
  }

  /** Focuses the first match of `selectors` (in order) inside row `index` once it rendered. */
  private focusAfterRender(index: number, ...selectors: string[]): void {
    afterNextRender(
      () => {
        const row = this.host.nativeElement.querySelector<HTMLElement>(`.fpc-list-editor__item[data-index="${index}"]`);

        for (const selector of selectors) {
          const target = row?.querySelector<HTMLElement>(selector);

          if (target) {
            target.focus();

            return;
          }
        }
      },
      { injector: this.injector },
    );
  }
}
