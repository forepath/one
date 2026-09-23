import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Outermost page section. Owns the `min-height: 0` / `overflow: hidden` chain that lets nested
 * rows and columns scroll instead of pushing the page.
 */
@Component({
  selector: 'fpc-section-container',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'section__container fpc-section-container' },
  template: `<ng-content />`,
  styleUrl: './section-container.component.scss',
})
export class FpcSectionContainerComponent {}
