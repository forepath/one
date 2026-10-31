import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { SavedView } from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcButtonComponent,
  FpcButtonGroupComponent,
  FpcDropdownComponent,
  FpcFormControlComponent,
} from '@forepath/shared/frontend/ui-components';

import { type SavedViewBinding, type SavedViewState, sameViewState, viewName } from './saved-views';
import { SavedViewsStore } from './saved-views.store';

/**
 * "Views" (3.37, icon-only bookmark trigger, dot = a view is applied): the caller's saved views of one list / the tree (`scope`), server-side per user. Apply, save the
 * current state (search, filters, columns, sort … from the `binding`) under a name — an existing
 * name is updated —, rename and delete (asks first). The view matching the current state is marked active.
 */
@Component({
  selector: 'loadweaver-saved-views',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, FpcButtonComponent, FpcButtonGroupComponent, FpcDropdownComponent, FpcFormControlComponent],
  host: { class: 'd-inline-flex' },
  template: `
    <!-- Hidden where views can't be stored (the fleet views: no active cluster, 2026-10-29 LW-25). -->
    @if (available()) {
      <fpc-dropdown
        #menu
        [(open)]="open"
        [closeOnSelect]="false"
        alignment="end"
        appendTo="body"
        data-testid="saved-views"
      >
        <span fpcDropdownTrigger class="lw-views__trigger">
          <!-- One slot everywhere (3.38): the first action of the header / strip; an icon button (dark in a header,
             the quiet ".fpc-toolbar-btn" treatment by context inside a list / table toolbar strip). -->
          <fpc-button
            variant="dark"
            size="sm"
            [iconOnly]="true"
            [ariaLabel]="viewsLabel"
            [title]="triggerTitle()"
            ariaHaspopup="menu"
            [ariaExpanded]="open()"
            [ariaControls]="open() ? menu.menuId() : null"
            data-testid="saved-views-toggle"
          >
            <i class="bi bi-bookmarks" aria-hidden="true"></i>
          </fpc-button>
          @if (active()) {
            <span class="lw-views__dot" aria-hidden="true" data-testid="saved-views-active"></span>
          }
        </span>
        <div class="lw-views px-2 py-1 small" (keydown.escape)="cancelEdit()">
          @if (store.error(); as message) {
            <div class="text-danger mb-1" role="alert" data-testid="saved-views-error">{{ message }}</div>
          }
          @for (view of views(); track view.id) {
            <div
              class="d-flex align-items-center gap-1 lw-views__row"
              [class.lw-views__row--active]="view.id === active()?.id"
            >
              @if (renaming() === view.id) {
                <label class="visually-hidden" [for]="'lw-views-rename-' + view.id">{{ renameLabel }}</label>
                <fpc-form-control
                  class="flex-grow-1"
                  size="sm"
                  [controlId]="'lw-views-rename-' + view.id"
                  maxLength="100"
                  [(ngModel)]="draftName"
                  (keydown.enter)="rename(view)"
                  [attr.data-testid]="'saved-views-rename-input-' + view.name"
                />
                <fpc-button variant="primary" size="sm" (clicked)="rename(view)">{{ saveLabel }}</fpc-button>
              } @else if (deleting() === view.id) {
                <span class="flex-grow-1 text-truncate">{{ deleteQuestion }} {{ view.name }}</span>
                <fpc-button variant="dark" size="sm" (clicked)="cancelEdit()">{{ cancelLabel }}</fpc-button>
                <fpc-button
                  variant="danger"
                  size="sm"
                  (clicked)="remove(view)"
                  [attr.data-testid]="'saved-views-delete-confirm-' + view.name"
                >
                  {{ deleteLabel }}
                </fpc-button>
              } @else {
                <fpc-button
                  class="flex-grow-1 min-w-0 lw-views__apply"
                  variant="link"
                  size="sm"
                  (clicked)="apply(view)"
                  [attr.data-testid]="'saved-views-apply-' + view.name"
                >
                  @if (view.id === active()?.id) {
                    <i class="bi bi-check2 me-1" aria-hidden="true"></i>
                  }
                  {{ view.name }}
                </fpc-button>
                <fpc-button-group size="sm" [ariaLabel]="view.name">
                  <fpc-button
                    variant="link"
                    size="sm"
                    [iconOnly]="true"
                    [title]="renameLabel"
                    [ariaLabel]="renameLabel + ': ' + view.name"
                    (clicked)="startRename(view)"
                    [attr.data-testid]="'saved-views-rename-' + view.name"
                  >
                    <i class="bi bi-pencil" aria-hidden="true"></i>
                  </fpc-button>
                  <fpc-button
                    variant="link"
                    size="sm"
                    [iconOnly]="true"
                    [title]="deleteLabel"
                    [ariaLabel]="deleteLabel + ': ' + view.name"
                    (clicked)="deleting.set(view.id); renaming.set(null)"
                    [attr.data-testid]="'saved-views-delete-' + view.name"
                  >
                    <i class="bi bi-trash" aria-hidden="true"></i>
                  </fpc-button>
                </fpc-button-group>
              }
            </div>
          } @empty {
            <div class="text-body-secondary py-1">{{ noViewsLabel }}</div>
          }
          <hr class="my-1" />
          @if (saving()) {
            <div class="d-flex align-items-center gap-1">
              <label class="visually-hidden" for="lw-views-name">{{ nameLabel }}</label>
              <fpc-form-control
                class="flex-grow-1"
                size="sm"
                controlId="lw-views-name"
                [placeholder]="nameLabel"
                maxLength="100"
                [(ngModel)]="draftName"
                (keydown.enter)="save()"
                data-testid="saved-views-name"
              />
              <fpc-button variant="primary" size="sm" (clicked)="save()" data-testid="saved-views-save">
                {{ saveLabel }}
              </fpc-button>
            </div>
            @if (overwrites()) {
              <div class="text-body-secondary mt-1">{{ overwriteHint }}</div>
            }
          } @else {
            <fpc-button variant="link" size="sm" (clicked)="startSave()" data-testid="saved-views-save-current">
              <i class="bi bi-plus-lg me-1" aria-hidden="true"></i>{{ saveCurrentLabel }}
            </fpc-button>
          }
        </div>
      </fpc-dropdown>
    }
  `,
  styles: `
    .lw-views__trigger {
      position: relative;
      display: inline-flex;
    }

    /* Active-view indicator: a saved view matches the current state. */
    .lw-views__dot {
      position: absolute;
      top: 0.25rem;
      right: 0.25rem;
      width: 0.5rem;
      height: 0.5rem;
      border-radius: 50%;
      background: var(--bs-primary);
      box-shadow: 0 0 0 1px var(--bs-body-bg);
      pointer-events: none;
    }

    .lw-views {
      min-width: 16rem;
      max-width: 22rem;
    }

    .lw-views__row {
      min-height: 1.75rem;
    }

    .lw-views__row--active {
      font-weight: 600;
    }

    .lw-views__apply ::ng-deep .btn {
      width: 100%;
      text-align: start;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `,
})
export class LoadweaverSavedViewsComponent {
  readonly store = inject(SavedViewsStore);

  /** The list id (`plans`, `contents`, `tree`, …); one set of views per scope and user. */
  readonly scope = input.required<string>();
  readonly binding = input.required<SavedViewBinding>();

  readonly open = signal(false);
  readonly saving = signal(false);
  readonly renaming = signal<string | null>(null);
  readonly deleting = signal<string | null>(null);
  draftName = '';

  readonly available = computed(() => this.store.available());
  readonly views = computed(() => this.store.views(this.scope())());
  readonly active = computed<SavedView | null>(() => {
    const current = this.binding().state();

    return this.views().find((view) => sameViewState(view.state, current)) ?? null;
  });

  readonly viewsLabel = $localize`:@@lwConsoleViews-views:Views`;
  readonly saveCurrentLabel = $localize`:@@lwConsoleViews-saveCurrent:Save current view…`;
  readonly nameLabel = $localize`:@@lwConsoleViews-name:View name`;
  readonly saveLabel = $localize`:@@lwConsoleViews-save:Save`;
  readonly renameLabel = $localize`:@@lwConsoleViews-rename:Rename`;
  readonly deleteLabel = $localize`:@@lwConsoleViews-delete:Delete`;
  readonly deleteQuestion = $localize`:@@lwConsoleViews-deleteQuestion:Delete`;
  readonly cancelLabel = $localize`:@@lwConsoleViews-cancel:Cancel`;
  readonly noViewsLabel = $localize`:@@lwConsoleViews-none:No saved views`;
  readonly overwriteHint = $localize`:@@lwConsoleViews-overwrite:A view of this name exists: saving updates it.`;

  /** Tooltip: "Views", plus the applied view's name. */
  readonly triggerTitle = computed(() => {
    const name = this.active()?.name;

    return name ? `${this.viewsLabel}: ${name}` : this.viewsLabel;
  });

  constructor() {
    effect(() => {
      const scope = this.scope();

      untracked(() => void this.store.load(scope));
    });
  }

  overwrites(): boolean {
    const name = viewName(this.draftName);

    return !!name && this.views().some((view) => view.name === name);
  }

  apply(view: SavedView): void {
    this.binding().apply(view.state);
    this.open.set(false);
  }

  startSave(): void {
    this.cancelEdit();
    this.draftName = this.active()?.name ?? '';
    this.saving.set(true);
  }

  async save(): Promise<void> {
    const name = viewName(this.draftName);

    if (!name) return;

    const state: SavedViewState = this.binding().state();

    if (await this.store.save(this.scope(), name, state)) this.cancelEdit();
  }

  startRename(view: SavedView): void {
    this.cancelEdit();
    this.draftName = view.name;
    this.renaming.set(view.id);
  }

  async rename(view: SavedView): Promise<void> {
    const name = viewName(this.draftName);

    if (!name || name === view.name) {
      this.cancelEdit();

      return;
    }

    if (await this.store.rename(view, name)) this.cancelEdit();
  }

  async remove(view: SavedView): Promise<void> {
    if (await this.store.remove(view)) this.cancelEdit();
  }

  cancelEdit(): void {
    this.saving.set(false);
    this.renaming.set(null);
    this.deleting.set(null);
    this.draftName = '';
  }
}
