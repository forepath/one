import { TestBed } from '@angular/core/testing';
import { AdminBillingService, ServicePlansFacade } from '@forepath/decabill/frontend/data-access-billing-console';
import { of } from 'rxjs';

import { createEmptyOfferFormLine } from './admin-offer-form.util';
import { AdminOfferLineEditorComponent } from './admin-offer-line-editor.component';

jest.mock('../billing-country-options', () => ({ getCountryDisplayName: (code: string) => code }));

describe('AdminOfferLineEditorComponent (article lines)', () => {
  let component: AdminOfferLineEditorComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ServicePlansFacade,
          useValue: { getServicePlans$: () => of([]), getServicePlansLoading$: () => of(false) },
        },
        { provide: AdminBillingService, useValue: { previewTax: () => of({ rates: { standard: 19, reduced: 7 } }) } },
      ],
    });
    component = TestBed.runInInjectionContext(() => new AdminOfferLineEditorComponent());
  });

  it('offers an Article line type', () => {
    expect(component.lineTypes).toContain('article');
    expect(component.lineTypeLabel('article')).toBe('Article');
  });

  it('switching Generic <-> Article keeps the standard fields and clears the article on the way back', () => {
    const line = { ...createEmptyOfferFormLine(), description: 'Router', quantity: 3, unitPriceNet: 10 };

    component.onLineTypeChange(line, 'article');
    expect(line).toEqual(expect.objectContaining({ lineType: 'article', quantity: 3, unitPriceNet: 10 }));

    line.inventoryArticleId = 'a1';
    component.onLineTypeChange(line, 'standard');
    expect(line).toEqual(expect.objectContaining({ lineType: 'standard', quantity: 3, inventoryArticleId: null }));
  });

  it('prefills price, empty description / unit label and VAT from the picked article; clearing keeps input', () => {
    const line = createEmptyOfferFormLine('article');

    component.onArticlePicked(line, {
      name: 'Router',
      unit: 'piece',
      salesPriceNet: 49.9,
      taxCategory: 'reduced',
    } as never);
    expect(line).toEqual(
      expect.objectContaining({ description: 'Router', unitPriceNet: 49.9, unitLabel: 'pcs', taxCategory: 'reduced' }),
    );

    component.onArticlePicked(line, null);
    expect(line).toEqual(expect.objectContaining({ description: 'Router', unitPriceNet: 49.9, unitLabel: 'pcs' }));
  });
});
