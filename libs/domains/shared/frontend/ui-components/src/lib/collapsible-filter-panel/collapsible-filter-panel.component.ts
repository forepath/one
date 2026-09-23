import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  input,
  model,
  output,
  signal,
} from '@angular/core';

import { FpcBadgeComponent } from '../badge/badge.component';

/**
 * Filter drawer with a summary header. The header shows how many filters are active and offers a
 * reset action; the filter controls themselves are projected as content.
 *
 * When open, the body overlays content below the header and its max-height is capped to the
 * remaining viewport space under the host so it scrolls instead of overflowing the page.
 */
@Component({
  selector: 'fpc-collapsible-filter-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FpcBadgeComponent],
  host: {
    class: 'fpc-collapsible-filter-panel',
    '[class.fpc-collapsible-filter-panel--open]': 'open()',
  },
  template: `
    <div class="fpc-collapsible-filter-panel__header">
      <button
        type="button"
        class="btn btn-link fpc-collapsible-filter-panel__toggle"
        [attr.aria-expanded]="open()"
        [attr.aria-controls]="bodyId"
        (click)="toggle()"
      >
        <i class="bi bi-funnel" aria-hidden="true"></i>
        <span>{{ title() }}</span>
        @if (activeCount() > 0) {
          <fpc-badge color="primary" [pill]="true">{{ activeCount() }}</fpc-badge>
        }
        <i class="bi" [class.bi-chevron-down]="!open()" [class.bi-chevron-up]="open()" aria-hidden="true"></i>
      </button>

      @if (showClear() && activeCount() > 0) {
        <button type="button" class="btn btn-link btn-sm fpc-collapsible-filter-panel__clear" (click)="cleared.emit()">
          {{ clearLabel() }}
        </button>
      }
    </div>

    @if (open()) {
      <div class="fpc-collapsible-filter-panel__body" [id]="bodyId" [style.max-height.px]="bodyMaxHeightPx()">
        <ng-content />
      </div>
    }
  `,
  styleUrl: './collapsible-filter-panel.component.scss',
})
export class FpcCollapsibleFilterPanelComponent {
  private static nextId = 0;

  private readonly hostRef = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);

  readonly open = model(false);
  readonly title = input('Filters');
  readonly activeCount = input(0);
  readonly showClear = input(true);
  readonly clearLabel = input('Clear all');

  readonly cleared = output<void>();

  /** Remaining viewport pixels below the host; drives body `max-height`. */
  protected readonly bodyMaxHeightPx = signal<number | null>(null);

  protected readonly bodyId = `fpc-collapsible-filter-panel-${FpcCollapsibleFilterPanelComponent.nextId++}`;

  constructor() {
    afterRenderEffect(() => {
      if (!this.open()) {
        this.bodyMaxHeightPx.set(null);
        return;
      }

      this.syncBodyMaxHeight();
    });

    const onViewportChange = (): void => {
      if (this.open()) {
        this.syncBodyMaxHeight();
      }
    };

    window.addEventListener('resize', onViewportChange);
    // Capture scrolls from nested overflow containers that move this host.
    window.addEventListener('scroll', onViewportChange, true);
    window.visualViewport?.addEventListener('resize', onViewportChange);
    window.visualViewport?.addEventListener('scroll', onViewportChange);

    this.destroyRef.onDestroy(() => {
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
      window.visualViewport?.removeEventListener('resize', onViewportChange);
      window.visualViewport?.removeEventListener('scroll', onViewportChange);
    });
  }

  protected toggle(): void {
    this.open.set(!this.open());
  }

  private syncBodyMaxHeight(): void {
    const hostBottom = this.hostRef.nativeElement.getBoundingClientRect().bottom;
    const viewport = window.visualViewport;
    const viewportBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
    const availablePx = Math.max(0, Math.floor(viewportBottom - hostBottom));

    this.bodyMaxHeightPx.set(availablePx);
  }
}
