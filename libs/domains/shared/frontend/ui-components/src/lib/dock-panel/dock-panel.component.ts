import { DOCUMENT } from '@angular/common';
import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  model,
  signal,
  untracked,
} from '@angular/core';

import { fpcClampSize, fpcReadPaneState, fpcSeparatorKeySize, fpcWritePaneState } from '../split-pane/pane-state';

/**
 * Bottom dock of a content column (task / event panels): a header strip that always stays visible
 * and a body that expands to a resizable height (drag the top edge, arrow keys on it, `Home` /
 * `End`). Height and collapse state persist under `storageKey`. On small screens consumers usually
 * render the body in a full-screen sheet instead.
 *
 * Slots: `[fpcDockPanelHeader]` (tabs, counts after the title), `[fpcDockPanelActions]` (trailing
 * buttons), default = body (scrolls on its own). `fill`: the body is a flex column without its own overflow and a
 * projected `fpc-data-table` fills it as the single scroll container (sticky head, pinned pager / tfoot).
 */
@Component({
  selector: 'fpc-dock-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'fpc-dock-panel',
    '[class.fpc-dock-panel--collapsed]': 'collapsed()',
    '[class.fpc-dock-panel--dragging]': 'dragging()',
    '[class.fpc-dock-panel--fill]': 'fill()',
  },
  template: `
    @if (!collapsed()) {
      <div
        class="fpc-dock-panel__gutter"
        role="separator"
        tabindex="0"
        aria-orientation="horizontal"
        [attr.aria-label]="resizeLabel()"
        [attr.aria-valuenow]="height()"
        [attr.aria-valuemin]="min()"
        [attr.aria-valuemax]="max()"
        (pointerdown)="startDrag($event)"
        (keydown)="onGutterKeydown($event)"
        data-testid="fpc-dock-panel-gutter"
      ></div>
    }
    <div class="fpc-dock-panel__header">
      <button
        type="button"
        class="fpc-dock-panel__toggle btn btn-sm btn-link"
        [attr.aria-expanded]="!collapsed()"
        [attr.aria-controls]="bodyId"
        [attr.title]="collapsed() ? expandLabel() : collapseLabel()"
        (click)="toggle()"
        data-testid="fpc-dock-panel-toggle"
      >
        <i class="bi" [class.bi-chevron-up]="collapsed()" [class.bi-chevron-down]="!collapsed()" aria-hidden="true"></i>
        <span class="fpc-dock-panel__title">{{ title() }}</span>
      </button>
      <div class="fpc-dock-panel__header-content">
        <ng-content select="[fpcDockPanelHeader]" />
      </div>
      <div class="fpc-dock-panel__actions">
        <ng-content select="[fpcDockPanelActions]" />
      </div>
    </div>
    <div class="fpc-dock-panel__body" [id]="bodyId" [hidden]="collapsed()" [style.height.px]="height()">
      <ng-content />
    </div>
  `,
  styleUrl: './dock-panel.component.scss',
})
export class FpcDockPanelComponent {
  private static nextId = 0;
  private readonly document = inject(DOCUMENT);

  readonly title = input('');
  readonly height = model(260);
  readonly min = input(120);
  readonly max = input(640);
  readonly step = input(24);
  readonly collapsed = model(true);
  readonly storageKey = input<string | null>(null);
  readonly expandLabel = input('Expand');
  readonly collapseLabel = input('Collapse');
  readonly resizeLabel = input('Resize');
  /** The body hosts one scrolling child (a data table) that fills it; the body itself does not scroll. */
  readonly fill = input(false, { transform: booleanAttribute });

  /** Id of the body region (for `aria-controls` on consumer triggers in the header slots). */
  readonly bodyId = `fpc-dock-panel-${FpcDockPanelComponent.nextId++}`;
  protected readonly dragging = signal(false);
  private restored = false;

  constructor() {
    effect(() => {
      const key = this.storageKey();

      untracked(() => {
        if (this.restored || !key) return;

        this.restored = true;
        const state = fpcReadPaneState(this.storage(), key);

        if (state) {
          this.height.set(fpcClampSize(state.size, this.min(), this.max()));
          this.collapsed.set(state.collapsed);
        }
      });
    });
    effect(() => {
      const state = { size: this.height(), collapsed: this.collapsed() };

      if (this.restored) fpcWritePaneState(this.storage(), this.storageKey(), state);
    });
  }

  toggle(): void {
    this.collapsed.set(!this.collapsed());
  }

  expand(): void {
    this.collapsed.set(false);
  }

  protected onGutterKeydown(event: KeyboardEvent): void {
    const next = fpcSeparatorKeySize(
      event.key,
      this.height(),
      this.min(),
      this.max(),
      this.step(),
      ['ArrowUp'],
      ['ArrowDown'],
    );

    if (next !== null) {
      event.preventDefault();
      this.height.set(next);
    }
  }

  protected startDrag(event: PointerEvent): void {
    if (event.button !== 0) return;

    event.preventDefault();
    const origin = event.clientY;
    const start = this.height();
    const view = this.document.defaultView;

    this.dragging.set(true);
    const move = (moveEvent: PointerEvent): void => {
      this.height.set(fpcClampSize(start + origin - moveEvent.clientY, this.min(), this.max()));
    };
    const stop = (): void => {
      this.dragging.set(false);
      view?.removeEventListener('pointermove', move);
      view?.removeEventListener('pointerup', stop);
      view?.removeEventListener('pointercancel', stop);
    };

    view?.addEventListener('pointermove', move);
    view?.addEventListener('pointerup', stop);
    view?.addEventListener('pointercancel', stop);
  }

  private storage(): Storage | null {
    try {
      return this.document.defaultView?.localStorage ?? null;
    } catch {
      return null;
    }
  }
}
