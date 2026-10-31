import '@angular/localize/init';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';

import { FOREPATH_INDUSTRIES, forepathIndustryById } from './industries';
import { FOREPATH_INDUSTRY_ROUTE_DATA_KEY, ForepathIndustryComponent } from './industry/industry.component';

describe('ForePath industries', () => {
  it('gives every solution a unique id and a link', () => {
    for (const industry of FOREPATH_INDUSTRIES) {
      const ids = industry.solutions.map((solution) => solution.id);

      expect(new Set(ids).size).toBe(ids.length);
      industry.solutions.forEach((solution) => expect(solution.link.route ?? solution.link.href).toBeTruthy());
    }
  });

  it('links Loadweaver where software solutions fit, like Agenstra and Decabill', () => {
    const hrefs = forepathIndustryById('software').solutions.map((solution) => solution.link.href);

    expect(hrefs).toEqual(
      expect.arrayContaining(['https://agenstra.com', 'https://decabill.com', 'https://loadweaver.com']),
    );
  });

  it('lets an odd last solution span the row', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { data: { [FOREPATH_INDUSTRY_ROUTE_DATA_KEY]: 'software' } } },
        },
        {
          provide: ENVIRONMENT,
          useValue: { socialPreview: { urls: { image: '' } }, application: { production: false } },
        },
      ],
    });
    const fixture = TestBed.createComponent(ForepathIndustryComponent);

    fixture.detectChanges();
    const columns = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('#solutions .row > div'));
    const solutions = forepathIndustryById('software').solutions;

    expect(columns).toHaveLength(solutions.length);
    expect(solutions.length % 2).toBe(1);
    expect(columns.at(-1)?.classList).toContain('col-lg-12');
    expect(columns[0]?.classList).not.toContain('col-lg-12');
    expect(columns.at(-1)?.querySelector('a[href="https://loadweaver.com"]')).toBeTruthy();
  });
});
