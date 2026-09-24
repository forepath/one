import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type FpcBreadcrumbsSize = 'sm' | 'md';

/**
 * Breadcrumb trail. The item container uses `role="list"` on a `div` so consumers can project
 * `fpc-breadcrumb-item` components without producing an invalid `ol > custom-element` tree.
 */
@Component({
  selector: 'fpc-breadcrumbs',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'fpc-breadcrumbs',
    '[class.fpc-breadcrumbs--sm]': 'size() === "sm"',
  },
  template: `
    <nav [attr.aria-label]="ariaLabel()">
      <div class="breadcrumb mb-0 fpc-breadcrumbs__list" role="list" [style.--bs-breadcrumb-divider]="dividerValue()">
        <ng-content />
      </div>
    </nav>
  `,
  styleUrl: './breadcrumbs.component.scss',
})
export class FpcBreadcrumbsComponent {
  readonly ariaLabel = input('Breadcrumb');
  /** Single character used between items. */
  readonly divider = input('/');
  readonly size = input<FpcBreadcrumbsSize>('md');

  protected dividerValue(): string {
    return `"${this.divider()}"`;
  }
}
