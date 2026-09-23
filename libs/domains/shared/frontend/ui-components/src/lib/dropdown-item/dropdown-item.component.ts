import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { IsActiveMatchOptions, RouterLink, RouterLinkActive } from '@angular/router';

/** Menu row for `fpc-dropdown` (action, `routerLink`, or `href` menuitem with optional icon / end actions). */
@Component({
  selector: 'fpc-dropdown-item',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive],
  host: { class: 'fpc-dropdown-item' },
  template: `
    @if (href(); as url) {
      <a
        [href]="disabled() ? null : url"
        [attr.target]="target()"
        [attr.rel]="rel()"
        [class]="rowClasses()"
        [attr.title]="title() || null"
        role="menuitem"
        [attr.aria-current]="active() ? 'true' : null"
        [attr.aria-disabled]="disabled() ? 'true' : null"
        [attr.tabindex]="disabled() ? -1 : null"
        (click)="onAnchorClick($event)"
      >
        @if (icon()) {
          <i class="bi bi-{{ icon() }}" aria-hidden="true"></i>
        }
        <span class="fpc-dropdown-item__label"><ng-content /></span>
        <div class="fpc-dropdown-item__end" (click)="$event.stopPropagation()">
          <ng-content select="[fpcDropdownItemEnd]" />
        </div>
      </a>
    } @else {
      <div
        [class]="rowClasses()"
        [attr.title]="title() || null"
        role="menuitem"
        [attr.aria-current]="active() ? 'true' : null"
        [attr.aria-disabled]="disabled() ? 'true' : null"
        [attr.tabindex]="disabled() ? -1 : 0"
        [routerLink]="routerLink()"
        routerLinkActive="active"
        [routerLinkActiveOptions]="resolvedRouterLinkActiveOptions()"
        (click)="onRowClick($event)"
        (keydown.enter)="onRowClick($event)"
      >
        @if (icon()) {
          <i class="bi bi-{{ icon() }}" aria-hidden="true"></i>
        }
        <span class="fpc-dropdown-item__label"><ng-content /></span>
        <div class="fpc-dropdown-item__end" (click)="$event.stopPropagation()">
          <ng-content select="[fpcDropdownItemEnd]" />
        </div>
      </div>
    }
  `,
  styleUrl: './dropdown-item.component.scss',
})
export class FpcDropdownItemComponent {
  readonly disabled = input(false);
  readonly active = input(false);
  readonly danger = input(false);
  readonly icon = input<string | null>(null);
  /** Extra classes on the row (e.g. portal nav item styling). */
  readonly itemClass = input<string | null>(null);
  /** Native `title` on the row (overflow tooltips, full paths). */
  readonly title = input<string | null>(null);
  /** When set, navigates in-app via `RouterLink` on the row. */
  readonly routerLink = input<string | readonly unknown[] | null>(null);
  readonly routerLinkActiveOptions = input<IsActiveMatchOptions | { exact: boolean } | null>(null);
  /** When set, renders an `<a href>` menuitem (e.g. external product links). */
  readonly href = input<string | null>(null);
  readonly target = input<string | null>(null);
  readonly rel = input<string | null>(null);

  readonly selected = output<void>();

  protected readonly resolvedRouterLinkActiveOptions = computed(() => {
    return this.routerLinkActiveOptions() ?? { exact: true };
  });

  protected readonly rowClasses = computed(() => {
    const classes = ['fpc-dropdown-item__row', 'dropdown-item'];

    if (this.active()) {
      classes.push('active');
    }

    if (this.danger()) {
      classes.push('text-danger');
    }

    if (this.disabled()) {
      classes.push('disabled');
    }

    const extra = this.itemClass()?.trim();

    if (extra) {
      classes.push(extra);
    }

    return classes.join(' ');
  });

  protected onRowClick(event: Event): void {
    if (this.disabled()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    // End-slot controls stop propagation; ignore non-primary mouse buttons.
    if (event instanceof MouseEvent && event.button !== 0) {
      return;
    }

    this.selected.emit();
  }

  protected onAnchorClick(event: MouseEvent): void {
    if (this.disabled()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    this.selected.emit();
  }
}
