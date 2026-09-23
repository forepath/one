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
  signal,
  viewChild,
} from '@angular/core';

/**
 * Tile grid that opens next to the sidebar (admin switcher pattern). Rendered inline rather than
 * appended to `<body>`; the panel uses `position: fixed` so overflow on sidebar/workspace ancestors
 * does not clip it. Vertical placement flips upward when needed; height is capped to the viewport
 * with scrolling and flush edge borders for mobile-friendly full-height sheets.
 *
 * Tile chrome for projected content lives in this component's styles (`::ng-deep`); hover tokens
 * inherit from `fpc-sidebar` when nested there.
 */
@Component({
  selector: 'fpc-sidebar-popover',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'fpc-sidebar-popover-host' },
  template: `
    <div class="fpc-sidebar-popover__trigger" (click)="toggle()">
      <ng-content select="[fpcSidebarPopoverTrigger]" />
    </div>

    @if (open()) {
      <div
        #panel
        class="fpc-sidebar-popover"
        role="dialog"
        [class.fpc-sidebar-popover--flush-top]="flushTop()"
        [class.fpc-sidebar-popover--flush-bottom]="flushBottom()"
        [class.fpc-sidebar-popover--scrollable]="scrollable()"
        [attr.aria-label]="ariaLabel()"
        [style.top.px]="panelTop()"
        [style.left.px]="panelLeft()"
        [style.max-height.px]="panelMaxHeight()"
      >
        <div class="popover-body">
          <div class="fpc-sidebar-popover__grid" [style.--fpc-sidebar-popover-columns]="columns()">
            <ng-content />
          </div>
        </div>
      </div>
    }
  `,
  styleUrl: './sidebar-popover.component.scss',
})
export class FpcSidebarPopoverComponent {
  private readonly elementRef = inject(ElementRef<HTMLElement>);
  private readonly injector = inject(Injector);
  private readonly panelRef = viewChild<ElementRef<HTMLElement>>('panel');

  readonly open = model(false);
  readonly columns = input(3);
  readonly ariaLabel = input<string | null>('Workspace switcher');

  /** Viewport coordinates and size for the fixed panel (set when opening). */
  protected readonly panelTop = signal(0);
  protected readonly panelLeft = signal(0);
  protected readonly panelMaxHeight = signal<number | null>(null);
  protected readonly flushTop = signal(false);
  protected readonly flushBottom = signal(false);
  protected readonly scrollable = signal(false);

  constructor() {
    effect(() => {
      if (!this.open()) {
        return;
      }

      afterNextRender(() => this.syncPanelPosition(), { injector: this.injector });
    });
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent): void {
    if (this.open() && !this.elementRef.nativeElement.contains(event.target as Node)) {
      this.open.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.open()) {
      this.open.set(false);
    }
  }

  @HostListener('window:resize')
  protected onResize(): void {
    if (this.open()) {
      this.syncPanelPosition();
    }
  }

  protected toggle(): void {
    this.open.set(!this.open());
  }

  private syncPanelPosition(): void {
    const hostRect = this.elementRef.nativeElement.getBoundingClientRect();
    const panel = this.panelRef()?.nativeElement;

    if (!panel) {
      return;
    }

    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    // Drop any prior cap so measuring is unconstrained (avoids scrollHeight/clientHeight noise).
    panel.style.maxHeight = 'none';

    // Unconstrained border-box height (includes borders; matches `box-sizing: border-box`).
    const naturalHeight = panel.offsetHeight;
    const panelWidth = panel.offsetWidth;

    const spaceBelow = viewportHeight - hostRect.top;
    const spaceAbove = hostRect.bottom;

    let top: number;

    if (naturalHeight <= spaceBelow) {
      top = hostRect.top;
    } else if (naturalHeight <= spaceAbove) {
      top = hostRect.bottom - naturalHeight;
    } else if (spaceBelow >= spaceAbove) {
      top = hostRect.top;
    } else {
      top = hostRect.bottom - naturalHeight;
    }

    // Pin into the viewport; top may be 0 (full-bleed to the page top).
    const usedHeight = Math.min(naturalHeight, viewportHeight);

    top = Math.min(Math.max(0, top), viewportHeight - usedHeight);

    const availableHeight = viewportHeight - top;
    // Only cap + scroll when content cannot fit; a standing max-height causes ~border-width phantom scroll.
    const needsScroll = naturalHeight > availableHeight + 0.5;
    const renderedHeight = needsScroll ? availableHeight : naturalHeight;

    let left = hostRect.right;

    if (left + panelWidth > viewportWidth) {
      left = Math.max(0, hostRect.left - panelWidth);
    }

    panel.style.maxHeight = '';

    this.panelTop.set(top);
    this.panelLeft.set(left);
    this.panelMaxHeight.set(needsScroll ? availableHeight : null);
    this.scrollable.set(needsScroll);
    this.flushTop.set(top <= 0);
    this.flushBottom.set(top + renderedHeight >= viewportHeight - 0.5);
  }
}
