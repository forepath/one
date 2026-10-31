import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  HostListener,
  afterRenderEffect,
  inject,
  input,
  model,
  viewChild,
} from '@angular/core';

import { FPC_OVERLAY_PORTAL, FpcBodyPortal } from '../overlay/body-portal';

/**
 * `start`: menu left = trigger left. `end`: menu right = trigger right. `auto` (default): `start`
 * inline; for `appendTo="body"` menus `end` when the trigger sits in the right half of the viewport.
 */
export type FpcDropdownAlignment = 'start' | 'end' | 'auto';

export type FpcDropdownDirection = 'down' | 'up';

/** `trigger`: the menu hangs off the trigger. `container`: it spans the nearest positioned ancestor. */
export type FpcDropdownWidth = 'trigger' | 'container';

/** `inline`: the menu stays in place (absolute). `body`: it is portaled to `<body>` (fixed). */
export type FpcDropdownAppendTo = 'inline' | 'body';

let nextMenuId = 0;

/**
 * Bootstrap dropdown without the Bootstrap JavaScript bundle. Project the trigger with
 * `[fpcDropdownTrigger]`; everything else becomes the menu content.
 */
@Component({
  selector: 'fpc-dropdown',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'fpc-dropdown',
    '[class.dropdown]': 'direction() === "down"',
    '[class.dropup]': 'direction() === "up"',
    '[class.fpc-dropdown--container]': 'width() === "container"',
  },
  template: `
    <div class="fpc-dropdown__trigger" (click)="toggle()">
      <ng-content select="[fpcDropdownTrigger]" />
    </div>

    @if (open()) {
      <div #menu [class]="menuClasses()" role="menu" [attr.id]="menuId()" (click)="onMenuClick()">
        <ng-content />
      </div>
    }
  `,
  styleUrl: './dropdown.component.scss',
})
export class FpcDropdownComponent {
  private readonly elementRef = inject(ElementRef<HTMLElement>);
  private readonly document = inject(DOCUMENT);
  private readonly portal = new FpcBodyPortal(this.document);
  private readonly menu = viewChild<ElementRef<HTMLElement>>('menu');
  private readonly portalEnabled = inject(FPC_OVERLAY_PORTAL);
  /** `appendTo="body"` takes effect where the app enabled overlay portals (`provideFpcOverlayPortal()`). */
  private readonly portaled = computed(() => this.portalEnabled && this.appendTo() === 'body');

  readonly open = model(false);
  /** Id of the open menu, for the trigger's `aria-controls` (unique by default). */
  readonly menuId = input(`fpc-dropdown-menu-${++nextMenuId}`);
  readonly alignment = input<FpcDropdownAlignment>('auto');
  readonly direction = input<FpcDropdownDirection>('down');
  /**
   * `container` lets the menu span the nearest positioned ancestor (e.g. a navbar container) instead
   * of the trigger, for multi-column panels.
   */
  readonly width = input<FpcDropdownWidth>('trigger');
  readonly disabled = input(false);
  /** Keeps the menu open after an item is activated (useful for multi-select filters). */
  readonly closeOnSelect = input(true);
  /**
   * `body` portals the open menu to `<body>` with `position: fixed` (popover layer) so no ancestor
   * stacking context, sticky header or `overflow` clip can cover it — use it for menus inside sticky
   * / clipped chrome (object headers, panel headers, lanes). Ancestor-scoped menu styles do not
   * reach a portaled menu; keep `inline` for those (landing navbars, styled session pickers).
   */
  readonly appendTo = input<FpcDropdownAppendTo>('inline');

  private resizeObserver: ResizeObserver | null = null;
  private trackedMenu: HTMLElement | null = null;
  private frame: number | null = null;

  constructor() {
    // Any scroll container may move the trigger: follow it (capture phase reaches nested scrollers).
    // Scrolling inside the menu itself does not move the trigger.
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && this.menu()?.nativeElement.contains(event.target)) return;

      this.onViewportChange();
    };
    const destroyRef = inject(DestroyRef);

    this.document.addEventListener('scroll', onScroll, true);
    destroyRef.onDestroy(() => {
      this.document.removeEventListener('scroll', onScroll, true);
      this.stopTracking();
      this.portal.dispose();
    });
    afterRenderEffect(() => {
      const menu = this.menu()?.nativeElement;
      const portaled = this.portaled();
      // Track the placement inputs so a change re-places the open menu.
      this.alignment();
      this.direction();

      if (!menu || !portaled) {
        this.stopTracking();
        this.portal.dispose();

        return;
      }

      this.portal.attach(menu);
      // Place now (before paint, no flash), again on the next frame once fonts / late content settled,
      // and whenever the menu's own size changes (async items, toggled rows).
      this.place(menu);
      this.track(menu);
    });
  }

  private track(menu: HTMLElement): void {
    const view = this.document.defaultView;

    if (this.frame !== null) view?.cancelAnimationFrame?.(this.frame);
    this.frame =
      view?.requestAnimationFrame?.(() => {
        this.frame = null;
        this.onViewportChange();
      }) ?? null;

    if (this.trackedMenu === menu) return;

    this.resizeObserver?.disconnect();
    this.trackedMenu = menu;
    const Observer = (view as (Window & typeof globalThis) | null)?.ResizeObserver;

    if (Observer) {
      this.resizeObserver = new Observer(() => this.onViewportChange());
      this.resizeObserver.observe(menu);
    }
  }

  private stopTracking(): void {
    if (this.frame !== null) this.document.defaultView?.cancelAnimationFrame?.(this.frame);
    this.frame = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.trackedMenu = null;
  }

  /** The visible trigger (the projected button), not the host — the host may be stretched (`w-100`, flex). */
  private anchorRect(): DOMRect {
    const host = this.elementRef.nativeElement as HTMLElement;
    const wrapper = host.querySelector(':scope > .fpc-dropdown__trigger') as HTMLElement | null;
    const trigger = (wrapper?.firstElementChild as HTMLElement | null) ?? wrapper ?? host;
    const rect = trigger.getBoundingClientRect();

    return rect.width || rect.height ? rect : host.getBoundingClientRect();
  }

  /**
   * Fixed viewport coordinates from the trigger's bounding rect: start-aligned (menu left = trigger
   * left) or end-aligned (menu right = trigger right; `auto` picks end when the trigger sits in the
   * right half of the viewport), below the trigger (flipped above when it does not fit), clamped into
   * the viewport with an 8 px margin. Inherited `.dropdown-menu` / component positioning (`top: 100%`,
   * `inset-inline-*`, dropup margin, Popper transforms) is neutralised inline.
   */
  private place(menu: HTMLElement): void {
    const margin = 8;
    const gap = 2;
    const view = this.document.defaultView;
    const vw = view?.innerWidth || this.document.documentElement.clientWidth || 1024;
    const vh = view?.innerHeight || this.document.documentElement.clientHeight || 768;
    const anchor = this.anchorRect();
    const style = menu.style;
    const scrollTop = menu.scrollTop;

    // Neutral measuring state at the viewport origin: full available width, so the measured size is the
    // menu's natural size (measuring at an old `left` near the right edge would wrap and under-measure).
    style.position = 'fixed';
    style.inset = 'auto';
    style.transform = 'none';
    style.margin = '0';
    style.left = '0px';
    style.top = '0px';
    style.minWidth = `${Math.round(anchor.width)}px`;
    style.maxWidth = `${vw - 2 * margin}px`;
    style.maxHeight = '';
    style.overflowY = '';
    style.zIndex = 'var(--fpc-z-popover, 1070)';

    const size = menu.getBoundingClientRect();
    const width = size.width || menu.offsetWidth;
    let height = size.height || menu.offsetHeight;

    const alignment = this.alignment();
    const alignEnd = alignment === 'end' || (alignment === 'auto' && anchor.left + anchor.width / 2 > vw / 2);
    let left = alignEnd ? anchor.right - width : anchor.left;

    left = Math.max(margin, Math.min(left, vw - width - margin));

    const spaceBelow = vh - anchor.bottom - gap - margin;
    const spaceAbove = anchor.top - gap - margin;
    const preferUp = this.direction() === 'up';
    const up = preferUp
      ? height <= spaceAbove || spaceAbove >= spaceBelow
      : height > spaceBelow && spaceAbove > spaceBelow;
    const room = Math.max(0, up ? spaceAbove : spaceBelow);

    if (height > room && room > 0) {
      // Neither side fits: cap to the larger side and scroll inside the menu.
      style.maxHeight = `${Math.floor(room)}px`;
      style.overflowY = 'auto';
      height = room;
    }

    let top = up ? anchor.top - gap - height : anchor.bottom + gap;

    top = Math.max(margin, Math.min(top, vh - height - margin));

    style.left = `${Math.round(left)}px`;
    style.top = `${Math.round(top)}px`;
    // The measuring reset may have clamped the menu's own scroll position.
    if (menu.scrollTop !== scrollTop) menu.scrollTop = scrollTop;
  }

  @HostListener('window:resize')
  protected onViewportChange(): void {
    const menu = this.menu()?.nativeElement;

    if (menu && this.portaled() && this.portal.attached) this.place(menu);
  }

  protected readonly menuClasses = computed(() => {
    const classes = ['dropdown-menu', 'show', 'fpc-dropdown__menu'];

    if (this.portaled()) {
      classes.push('fpc-dropdown__menu--portaled');
    } else if (this.alignment() === 'end') {
      classes.push('dropdown-menu-end');
    }

    return classes.join(' ');
  });

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent): void {
    const target = event.target as Node;

    if (
      this.open() &&
      !this.elementRef.nativeElement.contains(target) &&
      !this.menu()?.nativeElement.contains(target)
    ) {
      this.open.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.open()) {
      this.open.set(false);
    }
  }

  protected toggle(): void {
    if (this.disabled()) {
      return;
    }

    this.open.set(!this.open());
  }

  protected onMenuClick(): void {
    if (this.closeOnSelect()) {
      this.open.set(false);
    }
  }
}
