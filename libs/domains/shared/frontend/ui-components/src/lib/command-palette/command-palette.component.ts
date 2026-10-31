import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  input,
  model,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';

import { FpcModalComponent } from '../modal/modal.component';
import { FpcSpinnerComponent } from '../spinner/spinner.component';

/** One entry of the palette. */
export interface FpcCommandItem<T = unknown> {
  id: string;
  label: string;
  /** Muted text after the label (kind, project, path). */
  hint?: string | null;
  /** Bootstrap icon name without `bi-`. */
  icon?: string | null;
  /** Short badge at the end (shortcut, "Action", "Go to tab"). */
  badge?: string | null;
  data?: T;
}

export interface FpcCommandGroup<T = unknown> {
  id: string;
  label: string;
  items: readonly FpcCommandItem<T>[];
}

/** An activated entry; `newTab` when Ctrl / ⌘ was held. */
export interface FpcCommandActivateEvent<T = unknown> {
  item: FpcCommandItem<T>;
  group: FpcCommandGroup<T>;
  newTab: boolean;
}

/**
 * Command palette shell (Ctrl / ⌘ K style): a query field and grouped results with ↑ ↓ / Enter
 * keyboard navigation (`role="combobox"` + `listbox`). Data stays in the consumer: it listens to
 * `query` and passes `groups`.
 *
 * Slots: `[fpcCommandPaletteEmpty]` (no entries), `[fpcCommandPaletteFooter]` (key hints, "All results").
 */
@Component({
  selector: 'fpc-command-palette',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FpcModalComponent, FpcSpinnerComponent],
  host: { class: 'fpc-command-palette' },
  template: `
    <fpc-modal
      [open]="open()"
      (openChange)="open.set($event)"
      [title]="title()"
      size="lg"
      [centered]="false"
      scrollable
    >
      <div class="input-group mb-2">
        <span class="input-group-text"><i class="bi bi-search" aria-hidden="true"></i></span>
        <input
          #queryInput
          type="search"
          class="form-control"
          autocomplete="off"
          role="combobox"
          aria-autocomplete="list"
          [attr.aria-label]="inputLabel()"
          [attr.aria-expanded]="entries().length > 0"
          [attr.aria-controls]="listId"
          [attr.aria-activedescendant]="activeDomId()"
          [placeholder]="placeholder()"
          [value]="query()"
          (input)="onInput($any($event.target).value)"
          (keydown)="onKeydown($event)"
          data-testid="fpc-command-palette-input"
        />
        @if (loading()) {
          <span class="input-group-text"><fpc-spinner size="sm" /></span>
        }
      </div>
      @if (entries().length > 0) {
        <div [id]="listId" role="listbox" class="fpc-command-palette__list" [attr.aria-label]="title()">
          @for (group of visibleGroups(); track group.id) {
            <div role="group" class="fpc-command-palette__group" [attr.aria-label]="group.label">
              <div class="fpc-command-palette__group-label text-body-secondary" aria-hidden="true">
                {{ group.label }}
              </div>
              @for (item of group.items; track item.id) {
                <div
                  role="option"
                  class="fpc-command-palette__item"
                  [id]="domId(group.id, item.id)"
                  [class.fpc-command-palette__item--active]="isActive(group.id, item.id)"
                  [attr.aria-selected]="isActive(group.id, item.id)"
                  [attr.data-item-id]="item.id"
                  (mousemove)="hover(group.id, item.id)"
                  (click)="activate(group, item, $event)"
                >
                  @if (item.icon) {
                    <i class="bi bi-{{ item.icon }} text-body-secondary" aria-hidden="true"></i>
                  }
                  <span class="text-truncate">{{ item.label }}</span>
                  @if (item.hint) {
                    <span class="text-body-secondary small text-truncate">{{ item.hint }}</span>
                  }
                  @if (item.badge) {
                    <span class="badge text-bg-secondary ms-auto">{{ item.badge }}</span>
                  }
                </div>
              }
            </div>
          }
        </div>
      } @else {
        <div class="fpc-command-palette__empty small text-body-secondary px-2 py-1">
          <ng-content select="[fpcCommandPaletteEmpty]" />
        </div>
      }
      <div class="fpc-command-palette__footer small text-body-secondary border-top pt-2 mt-2">
        <ng-content select="[fpcCommandPaletteFooter]" />
      </div>
    </fpc-modal>
  `,
  styleUrl: './command-palette.component.scss',
})
export class FpcCommandPaletteComponent<T = unknown> {
  private static nextId = 0;
  private readonly queryInput = viewChild<ElementRef<HTMLInputElement>>('queryInput');

  readonly open = model(false);
  readonly query = model('');
  readonly groups = input<readonly FpcCommandGroup<T>[]>([]);
  readonly loading = input(false);
  readonly title = input('Search');
  readonly placeholder = input('Search or type a command');
  readonly inputLabel = input('Search');

  readonly itemActivate = output<FpcCommandActivateEvent<T>>();

  protected readonly listId = `fpc-command-palette-${FpcCommandPaletteComponent.nextId++}`;
  protected readonly visibleGroups = computed(() => this.groups().filter((group) => group.items.length > 0));
  readonly entries = computed(() =>
    this.visibleGroups().flatMap((group) => group.items.map((item) => ({ group, item }))),
  );
  readonly activeIndex = signal(0);
  protected readonly activeEntry = computed(() => this.entries()[this.activeIndex()] ?? null);
  protected readonly activeDomId = computed(() => {
    const entry = this.activeEntry();

    return entry ? this.domId(entry.group.id, entry.item.id) : null;
  });

  constructor() {
    // New results: start at the top again.
    effect(() => {
      this.groups();
      untracked(() => this.activeIndex.set(0));
    });
    effect(() => {
      if (this.open()) setTimeout(() => this.queryInput()?.nativeElement.focus());
    });
  }

  show(): void {
    this.open.set(true);
  }

  close(): void {
    this.open.set(false);
  }

  protected domId(groupId: string, itemId: string): string {
    return `${this.listId}-${groupId}-${itemId}`.replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  protected isActive(groupId: string, itemId: string): boolean {
    const entry = this.activeEntry();

    return !!entry && entry.group.id === groupId && entry.item.id === itemId;
  }

  protected hover(groupId: string, itemId: string): void {
    const index = this.entries().findIndex((entry) => entry.group.id === groupId && entry.item.id === itemId);

    if (index >= 0 && index !== this.activeIndex()) this.activeIndex.set(index);
  }

  protected onInput(value: string): void {
    this.query.set(value);
    this.activeIndex.set(0);
  }

  protected onKeydown(event: KeyboardEvent): void {
    const count = this.entries().length;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (count > 0) this.activeIndex.set((this.activeIndex() + 1) % count);
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (count > 0) this.activeIndex.set((this.activeIndex() - 1 + count) % count);
        break;
      case 'Enter': {
        event.preventDefault();
        event.stopPropagation();
        const entry = this.activeEntry();
        if (entry) this.activate(entry.group, entry.item, event);
        break;
      }
    }
  }

  protected activate(group: FpcCommandGroup<T>, item: FpcCommandItem<T>, event: MouseEvent | KeyboardEvent): void {
    this.itemActivate.emit({ item, group, newTab: event.ctrlKey || event.metaKey });
  }
}
