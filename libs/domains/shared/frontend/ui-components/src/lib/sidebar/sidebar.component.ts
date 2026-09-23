import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Narrow icon rail used by the consoles. Nav tiles project into the scrollable column; pin the
 * admin/settings trigger with `[fpcSidebarFooter]` so it stays at the bottom while items scroll.
 */
@Component({
  selector: 'fpc-sidebar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'sidebar fpc-sidebar bg-body-tertiary',
    '[style.--fpc-sidebar-width]': 'width()',
    '[attr.role]': '"navigation"',
    '[attr.aria-label]': 'ariaLabel()',
  },
  template: `
    <div class="fpc-sidebar__items">
      <ng-content />
    </div>
    <div class="fpc-sidebar__footer">
      <ng-content select="[fpcSidebarFooter]" />
    </div>
  `,
  styleUrl: './sidebar.component.scss',
})
export class FpcSidebarComponent {
  readonly width = input('calc(2rem + 40.5px)');
  readonly ariaLabel = input<string | null>('Main navigation');
}
