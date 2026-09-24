import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  HostListener,
  inject,
  Injector,
  input,
  model,
  OnDestroy,
  output,
  PLATFORM_ID,
  signal,
  viewChild,
} from '@angular/core';

import { FpcSpinnerComponent } from '../spinner/spinner.component';

export type FpcTypeaheadSelectSize = 'sm' | 'md';

/** `menu` — floating body-portaled dropdown. `inline` — results list in document flow under the input. */
export type FpcTypeaheadSelectVariant = 'menu' | 'inline';

/**
 * Presentational typeahead shell. The component owns the query input and the results chrome;
 * filtering and rendering of results stay with the consumer:
 *
 * - `[fpcTypeaheadSelection]` — chips or summary for the current selection
 * - `[fpcTypeaheadSuggestions]` — the suggestion list
 *
 * **Variants**
 * - `menu` (default): suggestion menu is portaled to `document.body` with `position: fixed`
 *   so modal `overflow` / dialog transforms cannot clip it (same approach as `fpc-tooltip`).
 * - `inline`: results render in flow below the input (modal search panels, full-width lists).
 *
 * While `loading` is true, the results host (menu or inline panel) stays hidden so empty-state
 * copy and an empty bordered panel cannot flash before the first response.
 */
@Component({
  selector: 'fpc-typeahead-select',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FpcSpinnerComponent],
  host: {
    class: 'fpc-typeahead-select',
    '[class.fpc-typeahead-select--sm]': 'size() === "sm"',
    '[class.fpc-typeahead-select--inline]': 'variant() === "inline"',
    '[class.fpc-typeahead-select--clearable]': 'clearable()',
  },
  template: `
    <div class="fpc-typeahead-select__selection">
      <ng-content select="[fpcTypeaheadSelection]" />
    </div>

    <div #anchor class="input-group fpc-typeahead-select__input-group border rounded">
      <i class="bi bi-search" aria-hidden="true"></i>
      <input
        type="text"
        class="form-control border-0 fpc-typeahead-select__input"
        [class.form-control-sm]="size() === 'sm'"
        role="combobox"
        autocomplete="off"
        [id]="inputId()"
        [attr.placeholder]="placeholder()"
        [attr.aria-label]="ariaLabel()"
        [attr.aria-expanded]="open()"
        [attr.aria-controls]="listboxId()"
        [attr.aria-required]="required() ? true : null"
        [disabled]="disabled()"
        [value]="query()"
        (input)="onInput($event)"
        (focus)="onFocus()"
        (keydown.escape)="close()"
      />
      @if (loading()) {
        <fpc-spinner size="sm" class="fpc-typeahead-select__spinner" label="Loading" />
      }
      @if (clearable() && query().length > 0) {
        <button
          type="button"
          class="btn btn-link border-0 fpc-typeahead-select__clear"
          [attr.aria-label]="clearAriaLabel()"
          (click)="clear()"
        >
          <i class="bi bi-x-lg" aria-hidden="true"></i>
        </button>
      }
    </div>

    @if (open()) {
      <div
        #menu
        [id]="listboxId()"
        role="listbox"
        [class]="resultsClass()"
        [hidden]="loading()"
        [style.top.px]="isMenuVariant() ? menuTop() : null"
        [style.left.px]="isMenuVariant() ? menuLeft() : null"
        [style.width.px]="isMenuVariant() ? menuWidth() : null"
        [style.max-height.px]="isMenuVariant() ? menuMaxHeight() : null"
      >
        <!-- Keep projection mounted under a hidden host while loading so empty-state copy cannot
             flash before the first response, and so the bordered panel is not visible empty. -->
        <div class="fpc-typeahead-select__suggestions">
          <ng-content select="[fpcTypeaheadSuggestions]" />
        </div>
      </div>
    }
  `,
  styleUrl: './typeahead-select.component.scss',
})
export class FpcTypeaheadSelectComponent implements OnDestroy {
  private readonly elementRef = inject(ElementRef<HTMLElement>);
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly anchorRef = viewChild<ElementRef<HTMLElement>>('anchor');
  private readonly menuRef = viewChild<ElementRef<HTMLElement>>('menu');
  private readonly onScrollReposition = (): void => this.syncMenuPosition();
  private scrollListenTargets: Array<HTMLElement | Window> = [];

  /** Soft cap; further clamped to available viewport space when open. */
  private static readonly MENU_MAX_HEIGHT_PX = 18 * 16;
  private static readonly MENU_GAP_PX = 2;

  readonly query = model('');
  readonly open = model(false);
  readonly placeholder = input<string | null>('Start typing…');
  readonly ariaLabel = input<string | null>(null);
  readonly clearAriaLabel = input('Clear selection');
  readonly inputId = input<string | null>(null);
  readonly listboxId = input('fpc-typeahead-select-listbox');
  readonly disabled = input(false);
  readonly loading = input(false);
  readonly clearable = input(true);
  readonly required = input(false);
  readonly size = input<FpcTypeaheadSelectSize>('md');
  /** Opens the suggestion popup as soon as the input receives focus. */
  readonly openOnFocus = input(true);
  /**
   * `menu` — floating portaled dropdown (default).
   * `inline` — results list below the input in document flow (modal searches).
   */
  readonly variant = input<FpcTypeaheadSelectVariant>('menu');

  readonly cleared = output<void>();

  protected readonly menuTop = signal(0);
  protected readonly menuLeft = signal(0);
  protected readonly menuWidth = signal(0);
  protected readonly menuMaxHeight = signal<number | null>(null);

  constructor() {
    effect(() => {
      if (!this.isBrowser) {
        return;
      }

      if (!this.open() || !this.isMenuVariant()) {
        this.restoreMenuToHost();
        this.detachScrollListeners();
        return;
      }

      // Track loading so the menu is repositioned when it becomes visible again.
      const loading = this.loading();

      afterNextRender(
        () => {
          if (!this.open() || !this.isMenuVariant()) {
            return;
          }

          this.portalMenuToBody();
          this.attachScrollListeners();

          if (!loading && !this.loading()) {
            this.syncMenuPosition();
          }
        },
        { injector: this.injector },
      );
    });
  }

  ngOnDestroy(): void {
    if (!this.isBrowser) {
      return;
    }

    this.restoreMenuToHost();
    this.detachScrollListeners();
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent): void {
    // Inline results are part of the page/modal flow; do not dismiss on outside click.
    if (!this.isBrowser || !this.open() || !this.isMenuVariant()) {
      return;
    }

    const target = event.target as Node;
    const inHost = this.elementRef.nativeElement.contains(target);
    const inMenu = this.menuRef()?.nativeElement.contains(target) ?? false;

    if (!inHost && !inMenu) {
      this.close();
    }
  }

  @HostListener('window:resize')
  protected onResize(): void {
    if (this.isBrowser && this.open() && this.isMenuVariant()) {
      this.syncMenuPosition();
    }
  }

  protected isMenuVariant(): boolean {
    return this.variant() === 'menu';
  }

  protected resultsClass(): string {
    return this.isMenuVariant() ? 'dropdown-menu show fpc-typeahead-select__menu' : 'fpc-typeahead-select__panel';
  }

  protected onInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.open.set(true);
  }

  protected onFocus(): void {
    if (this.openOnFocus() && !this.disabled()) {
      this.open.set(true);
    }
  }

  protected close(): void {
    this.restoreMenuToHost();
    this.detachScrollListeners();
    this.open.set(false);
  }

  protected clear(): void {
    this.query.set('');
    this.cleared.emit();
  }

  private portalMenuToBody(): void {
    if (!this.isBrowser) {
      return;
    }

    const menu = this.menuRef()?.nativeElement;

    if (menu && menu.parentElement !== this.document.body) {
      this.document.body.appendChild(menu);
    }
  }

  private restoreMenuToHost(): void {
    if (!this.isBrowser) {
      return;
    }

    const menu = this.menuRef()?.nativeElement;

    if (menu?.parentElement === this.document.body) {
      this.elementRef.nativeElement.appendChild(menu);
    }
  }

  private attachScrollListeners(): void {
    if (!this.isBrowser) {
      return;
    }

    this.detachScrollListeners();

    const targets: Array<HTMLElement | Window> = [window];
    let el: HTMLElement | null = this.elementRef.nativeElement.parentElement;

    while (el) {
      const { overflow, overflowX, overflowY } = getComputedStyle(el);

      if (this.isClipValue(overflow) || this.isClipValue(overflowX) || this.isClipValue(overflowY)) {
        targets.push(el);
      }

      el = el.parentElement;
    }

    for (const target of targets) {
      target.addEventListener('scroll', this.onScrollReposition, { passive: true });
    }

    this.scrollListenTargets = targets;
  }

  private detachScrollListeners(): void {
    for (const target of this.scrollListenTargets) {
      target.removeEventListener('scroll', this.onScrollReposition);
    }

    this.scrollListenTargets = [];
  }

  private syncMenuPosition(): void {
    if (!this.isBrowser) {
      return;
    }

    const menu = this.menuRef()?.nativeElement;
    const anchor = this.anchorRef()?.nativeElement;

    if (!menu || !anchor || !this.open() || !this.isMenuVariant()) {
      return;
    }

    this.portalMenuToBody();

    const gap = FpcTypeaheadSelectComponent.MENU_GAP_PX;
    const softMax = FpcTypeaheadSelectComponent.MENU_MAX_HEIGHT_PX;
    const anchorRect = anchor.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    menu.style.maxHeight = 'none';

    const naturalHeight = menu.offsetHeight;
    const spaceBelow = viewportHeight - anchorRect.bottom - gap;
    const spaceAbove = anchorRect.top - gap;
    const openBelow = naturalHeight <= spaceBelow || spaceBelow >= spaceAbove;
    const available = Math.max(0, openBelow ? spaceBelow : spaceAbove);
    const maxHeight = Math.min(softMax, available);
    const usedHeight = Math.min(naturalHeight, maxHeight);

    let top = openBelow ? anchorRect.bottom + gap : anchorRect.top - gap - usedHeight;
    let left = anchorRect.left;
    const width = anchorRect.width;

    top = Math.min(Math.max(0, top), Math.max(0, viewportHeight - usedHeight));
    left = Math.min(Math.max(0, left), Math.max(0, viewportWidth - width));

    menu.style.maxHeight = '';

    this.menuTop.set(top);
    this.menuLeft.set(left);
    this.menuWidth.set(width);
    this.menuMaxHeight.set(maxHeight);
  }

  private isClipValue(value: string): boolean {
    return value === 'auto' || value === 'scroll' || value === 'hidden' || value === 'clip';
  }
}
