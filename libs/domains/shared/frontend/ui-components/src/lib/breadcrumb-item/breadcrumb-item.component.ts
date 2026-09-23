import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/** Single crumb inside `fpc-breadcrumbs` (link or current-page text). */
@Component({
  selector: 'fpc-breadcrumb-item',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'breadcrumb-item fpc-breadcrumb-item',
    '[class.active]': 'active()',
    '[attr.role]': '"listitem"',
    '[attr.aria-current]': 'active() ? "page" : null',
    '[attr.title]': 'title()',
  },
  template: `
    @if (active() || href() === null) {
      <span class="fpc-breadcrumb-item__text">{{ label() }}<ng-content /></span>
    } @else {
      <a class="fpc-breadcrumb-item__link" [attr.href]="href()" (click)="selected.emit($event)">
        {{ label() }}<ng-content />
      </a>
    }
  `,
  styleUrl: './breadcrumb-item.component.scss',
})
export class FpcBreadcrumbItemComponent {
  readonly label = input('');
  /** Native tooltip; useful when the label truncates. */
  readonly title = input<string | null>(null);
  /** Omit for the current page, or for items handled purely through `selected`. */
  readonly href = input<string | null>(null);
  readonly active = input(false);

  readonly selected = output<MouseEvent>();
}
