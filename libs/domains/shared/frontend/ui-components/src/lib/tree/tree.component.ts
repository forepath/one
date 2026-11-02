import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';

import { FpcDensityService } from '../density/density.service';
import { FpcLongPressDirective } from '../long-press/long-press.directive';
import {
  FpcTreeNode,
  FpcTreeRow,
  fpcFlattenTree,
  fpcScrollIntoView,
  fpcTreePath,
  fpcVirtualWindow,
} from './tree.model';

/** A context-menu request for a node (right click, long press, `Shift+F10` / the menu key). */
export interface FpcTreeContextMenuEvent<T = unknown> {
  node: FpcTreeNode<T>;
  x: number;
  y: number;
}

const ROW_HEIGHT = { compact: 28, comfortable: 34 } as const;

let nextTreeId = 0;

/**
 * Virtualized, keyboard-accessible tree (`role="tree"`, WAI-ARIA tree view keys). Data-driven:
 * pass `nodes`; expansion and selection are two-way (`expanded`, `selectedId`). Lazy children:
 * a node with `hasChildren` and no `children` emits `expandRequest` when expanded. Each node shows
 * an icon, a health dot (`status`), a `●` draft mark (`mark`), a muted hint and a count badge.
 * Row height follows `FpcDensityService` (28 / 34 px). Filtering stays in the consumer
 * (`fpcFilterTree` keeps ancestors, `fpcTreeBranchIds` expands the result).
 */
@Component({
  selector: 'fpc-tree',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FpcLongPressDirective],
  host: { class: 'fpc-tree' },
  template: `
    <div
      #viewport
      class="fpc-tree__viewport"
      role="tree"
      tabindex="0"
      [attr.aria-label]="ariaLabel()"
      [attr.aria-activedescendant]="activeRowId()"
      (scroll)="onScroll()"
      (keydown)="onKeydown($event)"
      (focus)="onFocus()"
      data-testid="fpc-tree"
    >
      @if (rows().length === 0) {
        <div class="fpc-tree__empty text-body-secondary small px-3 py-2">{{ emptyText() }}</div>
      } @else {
        <div class="fpc-tree__spacer" [style.height.px]="rows().length * rowHeight()">
          @for (row of visibleRows(); track row.node.id) {
            <div
              class="fpc-tree__row"
              role="treeitem"
              [id]="rowDomId(row.node.id)"
              [class.fpc-tree__row--selected]="row.node.id === selectedId()"
              [class.fpc-tree__row--active]="row.node.id === activeId()"
              [class.fpc-tree__row--disabled]="row.node.disabled"
              [style.height.px]="rowHeight()"
              [style.transform]="'translateY(' + rowTop(row) + 'px)'"
              [style.padding-left.rem]="0.5 + (row.level - 1) * indent()"
              [attr.aria-level]="row.level"
              [attr.aria-setsize]="row.setSize"
              [attr.aria-posinset]="row.posInSet"
              [attr.aria-expanded]="row.expandable ? row.expanded : null"
              [attr.aria-selected]="row.node.id === selectedId()"
              [attr.aria-disabled]="row.node.disabled || null"
              [attr.data-node-id]="row.node.id"
              (click)="onRowClick(row, $event)"
              (dblclick)="toggle(row)"
              (contextmenu)="onContextMenu(row, $event)"
              (fpcLongPress)="emitMenu(row.node, $event.x, $event.y)"
            >
              <span
                class="fpc-tree__twisty"
                [class.fpc-tree__twisty--hidden]="!row.expandable"
                (click)="onTwistyClick(row, $event)"
                aria-hidden="true"
              >
                <i class="bi" [class.bi-chevron-right]="!row.expanded" [class.bi-chevron-down]="row.expanded"></i>
              </span>
              @if (row.node.status) {
                <span
                  class="fpc-tree__status fpc-tree__status--{{ row.node.status }}"
                  [attr.title]="row.node.statusLabel ?? null"
                ></span>
                @if (row.node.statusLabel) {
                  <span class="visually-hidden">{{ row.node.statusLabel }}</span>
                }
              }
              @if (row.node.icon) {
                <i class="bi bi-{{ row.node.icon }} fpc-tree__icon" aria-hidden="true"></i>
              }
              <span class="fpc-tree__label text-truncate" [attr.title]="row.node.label">{{ row.node.label }}</span>
              @if (row.node.mark) {
                <span class="fpc-tree__mark" [attr.title]="row.node.markLabel ?? null" aria-hidden="true">●</span>
                @if (row.node.markLabel) {
                  <span class="visually-hidden">{{ row.node.markLabel }}</span>
                }
              }
              @if (row.node.hint) {
                <span class="fpc-tree__hint text-body-secondary text-truncate" [attr.title]="row.node.hint">{{
                  row.node.hint
                }}</span>
              }
              @if (row.node.badge !== null && row.node.badge !== undefined && row.node.badge !== '') {
                <span class="fpc-tree__badge badge rounded-pill">{{ row.node.badge }}</span>
              }
            </div>
          }
        </div>
      }
    </div>
  `,
  styleUrl: './tree.component.scss',
})
export class FpcTreeComponent<T = unknown> {
  private readonly density = inject(FpcDensityService);
  private readonly viewport = viewChild<ElementRef<HTMLElement>>('viewport');
  private readonly scrollTop = signal(0);
  private readonly viewportHeight = signal(600);
  private readonly domPrefix = `fpc-tree-${nextTreeId++}`;

  readonly nodes = input<readonly FpcTreeNode<T>[]>([]);
  readonly expanded = model<readonly string[]>([]);
  readonly selectedId = model<string | null>(null);
  readonly ariaLabel = input<string | null>(null);
  readonly emptyText = input('Nothing to show');
  /** Indentation per level in rem. */
  readonly indent = input(1);
  /** Arrow keys also select (navigation trees like a resource tree). */
  readonly selectOnFocus = input(false);

  /** Click / Enter on a node (after `selectedId` is updated). */
  readonly nodeActivate = output<FpcTreeNode<T>>();
  /** A lazy node (`hasChildren`, no `children`) was expanded. */
  readonly expandRequest = output<FpcTreeNode<T>>();
  readonly nodeContextMenu = output<FpcTreeContextMenuEvent<T>>();

  protected readonly activeId = signal<string | null>(null);

  protected readonly expandedSet = computed(() => new Set(this.expanded()));
  readonly rows = computed(() => fpcFlattenTree(this.nodes(), this.expandedSet()));
  protected readonly rowHeight = computed(() => ROW_HEIGHT[this.density.density()]);
  private readonly window = computed(() =>
    fpcVirtualWindow(this.scrollTop(), this.viewportHeight(), this.rowHeight(), this.rows().length),
  );
  private readonly indexById = computed(() => new Map(this.rows().map((row, index) => [row.node.id, index])));
  protected readonly visibleRows = computed(() => {
    const { start, end } = this.window();

    return this.rows().slice(start, end);
  });
  protected readonly activeRowId = computed(() => {
    const id = this.activeId();

    return id !== null && this.indexById().has(id) ? this.rowDomId(id) : null;
  });

  constructor() {
    const destroyRef = inject(DestroyRef);

    afterNextRender(() => {
      const element = this.viewport()?.nativeElement;

      if (!element) return;

      this.viewportHeight.set(element.clientHeight || 600);
      if (typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(() => this.viewportHeight.set(element.clientHeight || 600));
        observer.observe(element);
        destroyRef.onDestroy(() => observer.disconnect());
      }
    });
  }

  /** Expands the ancestors of `id`, selects it and scrolls it into view. Returns `false` when it is not in the tree. */
  reveal(id: string): boolean {
    const path = fpcTreePath(this.nodes(), id);

    if (path.length === 0) return false;

    const ancestors = path.slice(0, -1).map((node) => node.id);
    const missing = ancestors.filter((ancestor) => !this.expandedSet().has(ancestor));

    if (missing.length > 0) this.expanded.set([...this.expanded(), ...missing]);
    this.selectedId.set(id);
    this.activeId.set(id);
    this.scrollToId(id);

    return true;
  }

  focus(): void {
    this.viewport()?.nativeElement.focus();
  }

  protected rowDomId(id: string): string {
    return `${this.domPrefix}-${id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  }

  protected rowTop(row: FpcTreeRow<T>): number {
    return (this.indexById().get(row.node.id) ?? 0) * this.rowHeight();
  }

  protected onScroll(): void {
    this.scrollTop.set(this.viewport()?.nativeElement.scrollTop ?? 0);
  }

  protected onFocus(): void {
    if (this.activeId() === null) {
      const rows = this.rows();
      this.activeId.set(this.selectedId() ?? rows[0]?.node.id ?? null);
    }
  }

  protected onRowClick(row: FpcTreeRow<T>, event: MouseEvent): void {
    event.stopPropagation();
    this.activeId.set(row.node.id);
    this.activate(row);
  }

  protected onTwistyClick(row: FpcTreeRow<T>, event: MouseEvent): void {
    event.stopPropagation();
    this.activeId.set(row.node.id);
    this.toggle(row);
  }

  protected onContextMenu(row: FpcTreeRow<T>, event: MouseEvent): void {
    event.preventDefault();
    this.activeId.set(row.node.id);
    this.emitMenu(row.node, event.clientX, event.clientY);
  }

  protected emitMenu(node: FpcTreeNode<T>, x: number, y: number): void {
    this.nodeContextMenu.emit({ node, x, y });
  }

  protected toggle(row: FpcTreeRow<T>): void {
    if (!row.expandable) return;

    if (row.expanded) {
      this.expanded.set(this.expanded().filter((id) => id !== row.node.id));
    } else {
      this.expanded.set([...this.expanded(), row.node.id]);
      if (row.node.hasChildren && row.node.children === undefined) this.expandRequest.emit(row.node);
    }
  }

  protected onKeydown(event: KeyboardEvent): void {
    const rows = this.rows();

    if (rows.length === 0) return;

    const index = this.indexById().get(this.activeId() ?? '') ?? -1;
    const row = index >= 0 ? rows[index] : null;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.moveTo(Math.min(rows.length - 1, index + 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.moveTo(Math.max(0, index - 1));
        break;
      case 'Home':
        event.preventDefault();
        this.moveTo(0);
        break;
      case 'End':
        event.preventDefault();
        this.moveTo(rows.length - 1);
        break;
      case 'ArrowRight':
        event.preventDefault();
        if (row?.expandable && !row.expanded) this.toggle(row);
        else if (row?.expanded) this.moveTo(index + 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        if (row?.expanded) this.toggle(row);
        else if (row?.parentId) this.moveTo(this.indexById().get(row.parentId) ?? index);
        break;
      case 'Enter':
      case ' ':
        if (row) {
          event.preventDefault();
          this.activate(row);
        }
        break;
      case 'ContextMenu':
      case 'F10':
        if (row && (event.key === 'ContextMenu' || event.shiftKey)) {
          event.preventDefault();
          const rect = this.viewport()?.nativeElement.getBoundingClientRect();
          this.emitMenu(row.node, (rect?.left ?? 0) + 24, (rect?.top ?? 0) + this.rowTop(row) - this.scrollTop() + 24);
        }
        break;
    }
  }

  private activate(row: FpcTreeRow<T>): void {
    if (row.node.disabled) return;

    this.selectedId.set(row.node.id);
    this.nodeActivate.emit(row.node);
  }

  private moveTo(index: number): void {
    const row = this.rows()[index];

    if (!row) return;

    this.activeId.set(row.node.id);
    this.scrollToId(row.node.id);
    if (this.selectOnFocus() && !row.node.disabled) {
      this.selectedId.set(row.node.id);
      this.nodeActivate.emit(row.node);
    }
  }

  private scrollToId(id: string): void {
    const index = this.indexById().get(id);
    const element = this.viewport()?.nativeElement;

    if (index === undefined || !element) return;

    const top = fpcScrollIntoView(
      index,
      element.scrollTop,
      element.clientHeight || this.viewportHeight(),
      this.rowHeight(),
    );

    if (top !== element.scrollTop) {
      element.scrollTop = top;
      this.scrollTop.set(top);
    }
  }
}
