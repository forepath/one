import { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { environment } from '@forepath/loadweaver/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { of } from 'rxjs';

import { PortalAppsComponent } from './apps/apps.component';
import { PortalCloudComponent } from './cloud/cloud.component';
import { PortalComparisonComponent } from './comparison/shared/layout/comparison-layout.component';
import { COMPARISON_SLUG_DATA_KEY } from './comparison/shared/misc/comparison-page.model';
import { PortalHomeComponent } from './home/home.component';
import { PortalHowItWorksComponent } from './how-it-works/how-it-works.component';
import { PortalPricingComponent } from './pricing/pricing.component';
import { PortalRemoteAccessComponent } from './remote-access/remote-access.component';

describe('Loadweaver landing pages', () => {
  const pages: [string, Type<unknown>][] = [
    ['home', PortalHomeComponent],
    ['how it works', PortalHowItWorksComponent],
    ['apps', PortalAppsComponent],
    ['remote access', PortalRemoteAccessComponent],
    ['cloud', PortalCloudComponent],
    ['pricing', PortalPricingComponent],
  ];

  beforeEach(() => {
    // jsdom has no scrolling; the pricing tier carousel scrolls its row.
    Element.prototype.scrollBy = jest.fn();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: ENVIRONMENT, useValue: environment }],
    });
  });

  it.each(pages)('%s renders one h1, sets a Loadweaver title and offers early access', (_name, page) => {
    const fixture = TestBed.createComponent(page);

    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelectorAll('h1')).toHaveLength(1);
    expect(document.title).toContain(':: Loadweaver');
    expect(element.textContent).toContain('Request early access');
    // Illustrations are images with an accessible name.
    element.querySelectorAll('[role="img"]').forEach((img) => expect(img.getAttribute('aria-label')).toBeTruthy());
  });

  it('renders a comparison page from its route data', () => {
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: {
        data: of({ [COMPARISON_SLUG_DATA_KEY]: 'nomad' }),
        snapshot: { data: { [COMPARISON_SLUG_DATA_KEY]: 'nomad' } },
      },
    });
    const fixture = TestBed.createComponent(PortalComparisonComponent);

    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('h1')?.textContent).toContain('Nomad');
    expect(element.querySelectorAll('tbody tr')).toHaveLength(10);
    expect(document.title).toBe('Nomad vs Loadweaver :: Loadweaver');
  });

  it('moves the pricing tier carousel with the arrows', () => {
    const fixture = TestBed.createComponent(PortalPricingComponent);

    fixture.detectChanges();
    const buttons = () =>
      Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
          '.pricing-carousel-scroll-buttons button',
        ),
      );

    expect(buttons().map((button) => button.disabled)).toEqual([false, true]);
    buttons()[0]?.click();
    fixture.detectChanges();
    expect(buttons().map((button) => button.disabled)).toEqual([true, false]);
    expect(Element.prototype.scrollBy).toHaveBeenCalled();
  });
});
