import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FpcThemeSwitcherComponent } from '@forepath/shared/frontend/ui-components';

import { LandingThemeService } from './landing-theme.service';

/** Light / dark toggle for the landing page navigation (desktop bar and mobile menu). */
@Component({
  selector: 'shared-landing-theme-toggle',
  standalone: true,
  imports: [FpcThemeSwitcherComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'shared-landing-theme-toggle' },
  template: `
    <fpc-theme-switcher
      variant="button"
      [dark]="theme.isDarkMode()"
      [ariaLabel]="ariaLabel"
      (darkChange)="theme.setTheme($event)"
    />
  `,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
    }

    :host ::ng-deep .fpc-theme-switcher__button {
      width: 2.5rem;
      height: 2.5rem;
      font-size: 1rem;
      color: var(--bs-nav-link-color, var(--bs-body-color));
    }

    :host ::ng-deep .fpc-theme-switcher__button:hover,
    :host ::ng-deep .fpc-theme-switcher__button:focus-visible {
      color: var(--bs-nav-link-hover-color, var(--bs-emphasis-color));
    }
  `,
})
export class LandingThemeToggleComponent {
  protected readonly theme = inject(LandingThemeService);
  protected readonly ariaLabel = $localize`:@@sharedFeatureLandingpageTheme-toggleAriaLabel:Toggle dark mode`;
}
