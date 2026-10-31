import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  afterRenderEffect,
  computed,
  inject,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';

import { FpcMenuItem } from '../menu/menu.types';
import { FPC_OVERLAY_PORTAL, FpcBodyPortal } from '../overlay/body-portal';

/** Where a context menu opens (viewport coordinates, e.g. `MouseEvent.clientX / clientY`). */
export interface FpcContextMenuPosition {
  x: number;
  y: number;
}

/** Keeps a `width` × `height` menu at `position` inside a `viewportWidth` × `viewportHeight` viewport (8 px margin). */
export function fpcClampMenuPosition(
  position: FpcContextMenuPosition,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
): FpcContextMenuPosition {
  const margin = 8;
  const x = position.x + width + margin > viewportWidth ? Math.max(margin, viewportWidth - width - margin) : position.x;
  const y =
    position.y + height + margin > viewportHeight ? Math.max(margin, viewportHeight - height - margin) : position.y;

  return { x, y };
}

/**
 * Right-click / long-press menu at a viewport position (fixed, clamped to the viewport). Opens when
 * `position` is set; closes on selection, outside click, scroll, `Esc` or `Tab`. Arrow keys move
 * between enabled entries.
 */
@Component({
  selector: 'fpc-context-menu',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'fpc-context-menu' },
  template: `
    @if (position(); as pos) {
      <div
        #menu
        class="dropdown-menu show fpc-context-menu__menu"
        role="menu"
        tabindex="-1"
        [attr.aria-label]="ariaLabel()"
        [style.left.px]="placed().x"
        [style.top.px]="placed().y"
        (keydown)="onKeydown($event)"
        data-testid="fpc-context-menu"
      >
        @for (item of items(); track item.id) {
          @if (item.dividerBefore) {
            <hr class="dropdown-divider" role="separator" />
          }
          @if (item.heading) {
            <h6 class="dropdown-header">{{ item.heading }}</h6>
          }
          <button
            type="button"
            role="menuitem"
            class="dropdown-item fpc-context-menu__item"
            [class.text-danger]="item.danger"
            [disabled]="item.disabled"
            [attr.title]="item.title ?? null"
            [attr.data-item-id]="item.id"
            (click)="choose(item)"
          >
            @if (item.icon) {
              <i class="bi bi-{{ item.icon }} me-2" aria-hidden="true"></i>
            }
            {{ item.label }}
          </button>
        }
      </div>
    }
  `,
  styleUrl: './context-menu.component.scss',
})
export class FpcContextMenuComponent {
  private readonly host = inject(ElementRef<HTMLElement>);
  /** The open menu lives at `<body>` level (no ancestor stacking context can cover it). */
  private readonly portal = new FpcBodyPortal(inject(DOCUMENT));
  private readonly portalEnabled = inject(FPC_OVERLAY_PORTAL);
  private readonly menu = viewChild<ElementRef<HTMLElement>>('menu');
  private readonly size = signal({ width: 0, height: 0 });

  readonly items = input<readonly FpcMenuItem[]>([]);
  /** `null` = closed. */
  readonly position = model<FpcContextMenuPosition | null>(null);
  readonly ariaLabel = input<string | null>(null);

  readonly itemSelect = output<FpcMenuItem>();
  readonly closed = output<void>();

  protected readonly placed = computed(() => {
    const pos = this.position() ?? { x: 0, y: 0 };
    const { width, height } = this.size();
    const view = this.host.nativeElement.ownerDocument?.defaultView;

    return fpcClampMenuPosition(pos, width, height, view?.innerWidth ?? 1024, view?.innerHeight ?? 768);
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.portal.dispose());
    afterRenderEffect(() => {
      const element = this.menu()?.nativeElement;

      if (!element) {
        this.portal.dispose();

        return;
      }

      if (this.portalEnabled) this.portal.attach(element);

      const rect = element.getBoundingClientRect();
      const { width, height } = this.size();

      if (rect.width !== width || rect.height !== height) {
        this.size.set({ width: rect.width, height: rect.height });
      }
      if (!element.contains(element.ownerDocument.activeElement)) {
        this.focusItem(0);
      }
    });
  }

  close(): void {
    if (this.position() === null) return;

    this.position.set(null);
    this.closed.emit();
  }

  protected choose(item: FpcMenuItem): void {
    if (item.disabled) return;

    this.itemSelect.emit(item);
    this.close();
  }

  protected onKeydown(event: KeyboardEvent): void {
    const buttons = this.buttons();
    const index = buttons.indexOf(event.target as HTMLButtonElement);

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.focusItem(index + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.focusItem(index <= 0 ? buttons.length - 1 : index - 1);
        break;
      case 'Home':
        event.preventDefault();
        this.focusItem(0);
        break;
      case 'End':
        event.preventDefault();
        this.focusItem(buttons.length - 1);
        break;
      case 'Escape':
      case 'Tab':
        event.preventDefault();
        this.close();
        break;
    }
  }

  @HostListener('document:mousedown', ['$event'])
  @HostListener('document:touchstart', ['$event'])
  protected onOutside(event: Event): void {
    const element = this.menu()?.nativeElement;

    if (element && !element.contains(event.target as Node)) {
      this.close();
    }
  }

  @HostListener('window:resize')
  @HostListener('window:blur')
  protected onViewportChange(): void {
    this.close();
  }

  private buttons(): HTMLButtonElement[] {
    const element = this.menu()?.nativeElement;

    return element ? Array.from(element.querySelectorAll<HTMLButtonElement>('button:not([disabled])')) : [];
  }

  private focusItem(index: number): void {
    const buttons = this.buttons();

    if (buttons.length === 0) {
      this.menu()?.nativeElement.focus();

      return;
    }
    buttons[((index % buttons.length) + buttons.length) % buttons.length].focus();
  }
}
