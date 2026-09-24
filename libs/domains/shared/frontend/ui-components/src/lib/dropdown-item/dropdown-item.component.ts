import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { IsActiveMatchOptions, RouterLink, RouterLinkActive } from '@angular/router';

/**
 * Menu row for `fpc-dropdown` (action, `routerLink`, or `href` menuitem with optional icon / end actions).
 *
 * Projected label + end-slot content use a single pair of `<ng-content>` nodes (never inside `@if`) —
 * Angular does not project into duplicate/default slots across `@if` / `@else` branches.
 */
@Component({
  selector: 'fpc-dropdown-item',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive],
  host: {
    class: 'fpc-dropdown-item',
  },
  template: `
    <a
      [href]="anchorHref()"
      [attr.target]="href() ? target() : null"
      [attr.rel]="href() ? rel() : null"
      [class]="rowClasses()"
      [attr.title]="title() || null"
      role="menuitem"
      [attr.aria-current]="active() ? 'true' : null"
      [attr.aria-disabled]="disabled() ? 'true' : null"
      [attr.tabindex]="disabled() ? -1 : 0"
      [routerLink]="routerLinkForRow()"
      routerLinkActive="active"
      [routerLinkActiveOptions]="resolvedRouterLinkActiveOptions()"
      (click)="onActivate($event)"
      (keydown.enter)="onActivate($event)"
    >
      @if (icon()) {
        <i class="bi bi-{{ icon() }}" aria-hidden="true"></i>
      }
      <span class="fpc-dropdown-item__label"><ng-content /></span>
      <div class="fpc-dropdown-item__end" (click)="$event.stopPropagation()">
        <ng-content select="[fpcDropdownItemEnd]" />
      </div>
    </a>
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
  /** When set, renders a real `href` menuitem (e.g. locale / external links). */
  readonly href = input<string | null>(null);
  readonly target = input<string | null>(null);
  readonly rel = input<string | null>(null);

  readonly selected = output<void>();

  protected readonly resolvedRouterLinkActiveOptions = computed(() => {
    return this.routerLinkActiveOptions() ?? { exact: true };
  });

  /** Only set `href` for external/full-page links; SPA rows use `routerLink` instead. */
  protected readonly anchorHref = computed(() => {
    const url = this.href();

    if (!url || this.disabled()) {
      return null;
    }

    return url;
  });

  protected readonly routerLinkForRow = computed(() => {
    if (this.href()) {
      return null;
    }

    return this.routerLink();
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

  protected onActivate(event: Event): void {
    if (this.disabled()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    // End-slot controls stop propagation; ignore non-primary mouse buttons.
    if (event instanceof MouseEvent && event.button !== 0) {
      return;
    }

    // Action-only rows (no href / routerLink) must not follow a bare `<a>`.
    if (!this.href() && !this.routerLink()) {
      event.preventDefault();
    }

    this.selected.emit();
  }
}
