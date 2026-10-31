import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, inject, input, output } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

/**
 * Single crumb inside `fpc-breadcrumbs`. Ancestors render as quiet "chips" (link, `routerLink` or, without either,
 * a button that only emits `selected`); the current item (`active`) is plain semibold text with
 * `aria-current="page"`. The look lives in `fpc-breadcrumbs` so hand-written crumbs (`.fpc-breadcrumb-item` with an
 * `<a>` / `<span>` child) get it too.
 */
@Component({
  selector: 'fpc-breadcrumb-item',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, RouterLink],
  host: {
    class: 'breadcrumb-item fpc-breadcrumb-item',
    '[class.active]': 'active()',
    '[attr.role]': '"listitem"',
    '[attr.aria-current]': 'active() ? "page" : null',
    '[attr.title]': 'resolvedTitle()',
    '[class.fpc-breadcrumb-item--icon-only]': 'iconOnly() && !!icon()',
  },
  template: `
    <ng-template #content>
      @if (icon()) {
        <i class="bi bi-{{ icon() }} fpc-breadcrumb-item__icon" aria-hidden="true"></i>
      }
      @if (iconOnly() && icon()) {
        <span class="visually-hidden">{{ label() }}</span>
      } @else {
        <span class="fpc-breadcrumb-item__label">{{ label() }}<ng-content /></span>
      }
    </ng-template>

    @if (active()) {
      <span class="fpc-breadcrumb-item__text"><ng-container [ngTemplateOutlet]="content" /></span>
    } @else if (href() !== null) {
      <a class="fpc-breadcrumb-item__link" [attr.href]="href()" (click)="selected.emit($event)">
        <ng-container [ngTemplateOutlet]="content" />
      </a>
    } @else if (routerLink() !== null) {
      <a
        class="fpc-breadcrumb-item__link"
        [routerLink]="routerLink()"
        [queryParams]="queryParams() ?? null"
        (click)="selected.emit($event)"
      >
        <ng-container [ngTemplateOutlet]="content" />
      </a>
    } @else {
      <button type="button" class="fpc-breadcrumb-item__link" (click)="selected.emit($event)">
        <ng-container [ngTemplateOutlet]="content" />
      </button>
    }
  `,
  styleUrl: './breadcrumb-item.component.scss',
})
export class FpcBreadcrumbItemComponent {
  private readonly router = inject(Router, { optional: true });
  private readonly route = inject(ActivatedRoute, { optional: true });

  /** @internal Host element; `fpc-breadcrumbs` measures it and collapses it into the overflow menu. */
  readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  readonly label = input('');
  /** Native tooltip; defaults to the label so truncated crumbs always show their full name. */
  readonly title = input<string | null>(null);
  /** Omit for the current page, or for items handled purely through `selected` (rendered as a button). */
  readonly href = input<string | null>(null);
  /** In-app link (ignored when `href` is set). */
  readonly routerLink = input<string | readonly unknown[] | null>(null);
  readonly queryParams = input<Record<string, string | number | boolean | null> | null>(null);
  /** Optional leading kind icon (Bootstrap Icons name without `bi-`), shown muted. */
  readonly icon = input<string | null>(null);
  /** Only the icon is visible (e.g. a "home" crumb); the label stays the accessible name and the tooltip. */
  readonly iconOnly = input(false);
  readonly active = input(false);

  readonly selected = output<MouseEvent>();

  protected resolvedTitle(): string | null {
    return this.title() ?? (this.label() || null);
  }

  /**
   * @internal Activation from the overflow menu: emits `selected` with a cancelable event; unless a handler calls
   * `preventDefault()`, follows `routerLink` / `href` like the inline crumb would.
   */
  activateFromMenu(): void {
    const event = new MouseEvent('click', { cancelable: true });

    this.selected.emit(event);

    if (event.defaultPrevented) return;

    const href = this.href();
    const link = this.routerLink();

    if (href !== null) {
      this.host.ownerDocument.defaultView?.location.assign(href);
    } else if (link !== null && this.router) {
      const commands = typeof link === 'string' ? [link] : [...link];

      void this.router.navigate(commands, {
        relativeTo: this.route ?? undefined,
        queryParams: this.queryParams() ?? undefined,
      });
    }
  }
}
