import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Bootstrap list group container. Uses `role="list"` on a `div` (rather than a `ul`) so callers
 * can project components as children without producing invalid markup. Flush lists keep the last
 * item's bottom border (unlike stock Bootstrap flush).
 */
@Component({
  selector: 'fpc-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'list-group fpc-list',
    '[class.list-group-flush]': 'flush()',
    '[class.fpc-list--borderless]': '!bordered()',
    '[attr.role]': '"list"',
    '[attr.aria-label]': 'ariaLabel()',
  },
  template: `<ng-content />`,
  styleUrl: './list.component.scss',
})
export class FpcListComponent {
  readonly flush = input(false);
  readonly bordered = input(true);
  readonly ariaLabel = input<string | null>(null);
}
