import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  computed,
  effect,
  inject,
  input,
  model,
  signal,
  untracked,
} from '@angular/core';

import { fpcClampSize, fpcReadPaneState, fpcSeparatorKeySize, fpcWritePaneState } from './pane-state';

export type FpcSplitPaneOrientation = 'horizontal' | 'vertical';

/**
 * Two panes with a draggable separator (pointer, arrow keys, `Home` / `End`, `Enter` collapses).
 * One pane (`fixed`, default `start`) has the size in px, the other fills the rest; both scroll on
 * their own. Size and collapse state persist in `localStorage` under `storageKey`.
 *
 * Slots: `[fpcSplitPaneStart]`, `[fpcSplitPaneEnd]`.
 */
@Component({
  selector: 'fpc-split-pane',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'fpc-split-pane',
    '[class.fpc-split-pane--vertical]': 'orientation() === "vertical"',
    '[class.fpc-split-pane--dragging]': 'dragging()',
  },
  template: `
    <div class="fpc-split-pane__pane fpc-split-pane__pane--start" [style]="startStyle()" [hidden]="startHidden()">
      <ng-content select="[fpcSplitPaneStart]" />
    </div>
    @if (!collapsed()) {
      <div
        class="fpc-split-pane__gutter"
        role="separator"
        tabindex="0"
        [attr.aria-orientation]="orientation() === 'horizontal' ? 'vertical' : 'horizontal'"
        [attr.aria-label]="separatorLabel()"
        [attr.aria-valuenow]="size()"
        [attr.aria-valuemin]="min()"
        [attr.aria-valuemax]="max()"
        (pointerdown)="startDrag($event)"
        (keydown)="onKeydown($event)"
        (dblclick)="resetSize()"
        data-testid="fpc-split-pane-gutter"
      ></div>
    }
    <div class="fpc-split-pane__pane fpc-split-pane__pane--end" [style]="endStyle()" [hidden]="endHidden()">
      <ng-content select="[fpcSplitPaneEnd]" />
    </div>
  `,
  styleUrl: './split-pane.component.scss',
})
export class FpcSplitPaneComponent {
  private readonly document = inject(DOCUMENT);

  readonly orientation = input<FpcSplitPaneOrientation>('horizontal');
  /** The pane that has the size; the other one fills the rest. */
  readonly fixed = input<'start' | 'end'>('start');
  readonly size = model(300);
  readonly min = input(160);
  readonly max = input(600);
  readonly defaultSize = input(300);
  readonly step = input(16);
  /** Hides the fixed pane (the other one fills everything). */
  readonly collapsed = model(false);
  readonly collapsible = input(true, { transform: booleanAttribute });
  readonly storageKey = input<string | null>(null);
  readonly separatorLabel = input('Resize');

  protected readonly dragging = signal(false);
  private restored = false;

  protected readonly startHidden = computed(() => this.fixed() === 'start' && this.collapsed());
  protected readonly endHidden = computed(() => this.fixed() === 'end' && this.collapsed());
  protected readonly startStyle = computed(() => (this.fixed() === 'start' ? this.fixedStyle() : 'flex: 1 1 auto'));
  protected readonly endStyle = computed(() => (this.fixed() === 'end' ? this.fixedStyle() : 'flex: 1 1 auto'));

  constructor() {
    effect(() => {
      const key = this.storageKey();

      untracked(() => {
        if (this.restored || !key) return;

        this.restored = true;
        const state = fpcReadPaneState(this.storage(), key);

        if (state) {
          this.size.set(fpcClampSize(state.size, this.min(), this.max()));
          this.collapsed.set(this.collapsible() && state.collapsed);
        }
      });
    });
    effect(() => {
      const state = { size: this.size(), collapsed: this.collapsed() };

      if (this.restored) fpcWritePaneState(this.storage(), this.storageKey(), state);
    });
  }

  toggleCollapsed(): void {
    if (this.collapsible()) this.collapsed.set(!this.collapsed());
  }

  protected resetSize(): void {
    this.size.set(fpcClampSize(this.defaultSize(), this.min(), this.max()));
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.toggleCollapsed();

      return;
    }

    const horizontal = this.orientation() === 'horizontal';
    const forward = horizontal ? 'ArrowRight' : 'ArrowDown';
    const backward = horizontal ? 'ArrowLeft' : 'ArrowUp';
    const [grow, shrink] = this.fixed() === 'start' ? [forward, backward] : [backward, forward];
    const next = fpcSeparatorKeySize(event.key, this.size(), this.min(), this.max(), this.step(), [grow], [shrink]);

    if (next !== null) {
      event.preventDefault();
      this.size.set(next);
    }
  }

  protected startDrag(event: PointerEvent): void {
    if (event.button !== 0) return;

    event.preventDefault();
    const horizontal = this.orientation() === 'horizontal';
    const origin = horizontal ? event.clientX : event.clientY;
    const startSize = this.size();
    const sign = this.fixed() === 'start' ? 1 : -1;
    const view = this.document.defaultView;

    this.dragging.set(true);
    const move = (moveEvent: PointerEvent): void => {
      const delta = (horizontal ? moveEvent.clientX : moveEvent.clientY) - origin;
      this.size.set(fpcClampSize(startSize + sign * delta, this.min(), this.max()));
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

  private fixedStyle(): string {
    return `flex: 0 0 ${this.size()}px`;
  }

  private storage(): Storage | null {
    try {
      return this.document.defaultView?.localStorage ?? null;
    } catch {
      return null;
    }
  }
}
