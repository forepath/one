import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Home hero facts: the lead figure across, then two cards side by side. Every fact is one the site
 * states elsewhere (proof section, industries, About timeline), so the cards never claim more than
 * the pages behind them. The home hero places the group in its bottom-right corner.
 */
@Component({
  selector: 'framework-forepath-hero-collage',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'forepath-hero-collage' },
  template: `
    <ul
      class="forepath-hero-collage__facts list-unstyled mb-0"
      i18n-aria-label="@@featureForepathHome-heroFactsLabel"
      aria-label="ForePath in numbers"
    >
      <li class="forepath-hero-collage__card forepath-hero-collage__card--years">
        <span class="forepath-hero-collage__value">10+</span>
        <span class="forepath-hero-collage__label" i18n="@@featureForepathHome-heroFactYears"
          >years with IT systems</span
        >
      </li>
      <li class="forepath-hero-collage__row">
        <ul class="list-unstyled mb-0 forepath-hero-collage__pair">
          <li class="forepath-hero-collage__card forepath-hero-collage__card--industries">
            <span class="forepath-hero-collage__value">6</span>
            <span class="forepath-hero-collage__label" i18n="@@featureForepathHome-heroFactIndustries"
              >industries we serve</span
            >
          </li>
          <li class="forepath-hero-collage__card forepath-hero-collage__card--oss">
            <i class="bi bi-github" aria-hidden="true"></i>
            <span class="forepath-hero-collage__label" i18n="@@featureForepathHome-heroFactOss"
              >Active in open source</span
            >
          </li>
        </ul>
      </li>
    </ul>
  `,
  styleUrl: './hero-collage.component.scss',
})
export class HeroCollageComponent {}
