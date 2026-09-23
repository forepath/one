import { ChangeDetectionStrategy, Component, HostListener, input, output } from '@angular/core';

/**
 * List row with title, meta, and actions content slots.
 *
 * Meta uses the Bootstrap small type scale. Prefer Decabill admin-list markup for meta rows
 * (icon + text spans; optional colored first value).
 *
 * Action buttons: danger for delete (trash icon), warning for edit (pencil icon),
 * secondary for every other action.
 */
@Component({
  selector: 'fpc-list-item',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'list-group-item fpc-list-item',
    '[class.list-group-item-action]': 'clickable()',
    '[class.active]': 'active()',
    '[class.disabled]': 'disabled()',
    '[attr.role]': '"listitem"',
    '[attr.tabindex]': 'clickable() && !disabled() ? 0 : null',
    '[attr.aria-current]': 'active() ? "true" : null',
    '[attr.aria-disabled]': 'disabled() ? "true" : null',
  },
  template: `
    <div class="fpc-list-item__body">
      <div class="fpc-list-item__title">
        <ng-content select="[fpcListItemTitle]" />
      </div>
      <div class="fpc-list-item__meta">
        <ng-content select="[fpcListItemMeta]" />
      </div>
      <div class="fpc-list-item__content">
        <ng-content />
      </div>
    </div>
    <div class="fpc-list-item__actions">
      <ng-content select="[fpcListItemActions]" />
    </div>
  `,
  styleUrl: './list-item.component.scss',
})
export class FpcListItemComponent {
  readonly active = input(false);
  readonly disabled = input(false);
  readonly clickable = input(false);

  readonly selected = output<void>();

  @HostListener('click')
  protected onClick(): void {
    this.emitSelection();
  }

  @HostListener('keydown.enter', ['$event'])
  @HostListener('keydown.space', ['$event'])
  protected onKeydown(event: Event): void {
    if (!this.clickable() || this.disabled()) {
      return;
    }

    event.preventDefault();
    this.emitSelection();
  }

  private emitSelection(): void {
    if (!this.clickable() || this.disabled()) {
      return;
    }

    this.selected.emit();
  }
}
