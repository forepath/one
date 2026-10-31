import { DatePipe } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import {
  AdminPromotionsFacade,
  AdminPromotionsService,
  ServicePlansFacade,
  ServiceTypesFacade,
  type AdminPromotionResponse,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { of, throwError } from 'rxjs';

import { AdminPromotionsPageComponent, promotionPlanOptions } from './admin-promotions-page.component';

jest.mock('../billing-country-options', () => ({ getCountryDisplayName: (code: string) => code }));

const promotion = (id: string, isActive = true): AdminPromotionResponse =>
  ({
    id,
    code: `CODE-${id}`,
    name: `Promotion ${id}`,
    isActive,
    redeemableFrom: '2026-01-01T00:00:00Z',
    redeemableTo: '2026-12-31T00:00:00Z',
    advantageType: 'free_days',
    advantageConfig: { days: 7 },
    subscriptionEligibility: 'new',
    redemptionCount: 2,
  }) as unknown as AdminPromotionResponse;

describe('AdminPromotionsPageComponent (data list)', () => {
  let service: { deactivate: jest.Mock };
  let facade: Record<string, jest.Mock>;
  let component: AdminPromotionsPageComponent;

  beforeEach(() => {
    service = { deactivate: jest.fn() };
    facade = {
      getPromotions$: jest.fn(() => of([promotion('a'), promotion('b'), promotion('c', false)])),
      getLoading$: jest.fn(() => of(false)),
      getCreating$: jest.fn(() => of(false)),
      getUpdating$: jest.fn(() => of(false)),
      getDeactivating$: jest.fn(() => of(false)),
      getError$: jest.fn(() => of(null)),
      getRedemptions$: jest.fn(() => of([])),
      getRedemptionsLoading$: jest.fn(() => of(false)),
      getTotal$: jest.fn(() => of(3)),
      getRedemptionsTotal$: jest.fn(() => of(0)),
      loadPromotions: jest.fn(),
      loadRedemptions: jest.fn(),
      deactivatePromotion: jest.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        DatePipe,
        { provide: AdminPromotionsFacade, useValue: facade },
        { provide: AdminPromotionsService, useValue: service },
        { provide: ServicePlansFacade, useValue: { getServicePlans$: () => of([]), loadServicePlans: jest.fn() } },
        { provide: ServiceTypesFacade, useValue: { getServiceTypes$: () => of([]), loadServiceTypes: jest.fn() } },
      ],
    });
    component = TestBed.runInInjectionContext(() => new AdminPromotionsPageComponent());
  });

  it('shows State + promotion name + code, ⋮ Deactivate only for active ones, and no raw id column', () => {
    expect(component.columns[0]).toEqual(expect.objectContaining({ id: 'status', type: 'state' }));
    expect(component.columns[1]).toEqual(expect.objectContaining({ id: 'name', required: true }));
    expect(component.columns.map((c) => c.id)).not.toContain('id');
    expect(component.rowMenu(promotion('a')).map((item) => item.id)).toEqual([
      'edit',
      'redemptions',
      'deactivate',
      'copy-id',
    ]);
    expect(component.rowMenu(promotion('c', false)).map((item) => item.id)).not.toContain('deactivate');
    expect(component.redemptionColumns[0]).toEqual(expect.objectContaining({ type: 'state' }));
  });

  it('bulk Deactivate calls deactivate per active promotion with per-item results (incl. denied)', async () => {
    service.deactivate.mockImplementation((id: string) => (id === 'b' ? throwError(() => ({ status: 403 })) : of({})));
    component.selected.set(['a', 'b', 'c']);

    await component.deactivateSelected();

    expect(service.deactivate).toHaveBeenCalledTimes(2);
    expect(service.deactivate).not.toHaveBeenCalledWith('c');
    expect(component.bulkResult()?.message).toContain('1 done');
    expect(component.bulkResult()?.message).toContain('1 not allowed');
    // Reloads the current page (replace-page), not page 1 / append.
    expect(facade['loadPromotions']).toHaveBeenLastCalledWith({ search: undefined, page: 1, pageSize: 25 });
  });

  it('loads the requested page with the search (server paging) and redemptions page by page', () => {
    component.paging.page.set(3);
    component.paging.reload();
    expect(facade['loadPromotions']).toHaveBeenLastCalledWith({ search: undefined, page: 3, pageSize: 25 });

    component.openRedemptionsModal(promotion('a'));
    TestBed.tick();
    expect(facade['loadRedemptions']).toHaveBeenLastCalledWith('a', 1, 25);

    component.redemptionsPage.set(2);
    TestBed.tick();
    expect(facade['loadRedemptions']).toHaveBeenLastCalledWith('a', 2, 25);
  });

  it('builds applicable-plan multi-select options (DB-08) and fits 1440 px (DB-02: eligibility off by default)', () => {
    expect(
      promotionPlanOptions(
        [
          { id: 'p1', name: 'Basic', serviceTypeId: 't1' },
          { id: 'p2', name: 'Free', serviceTypeId: null },
        ],
        [{ id: 't1', name: 'Cloud server' }],
      ),
    ).toEqual([
      { value: 'p1', label: 'Basic', hint: 'Cloud server' },
      { value: 'p2', label: 'Free' },
    ]);

    const component = TestBed.createComponent(AdminPromotionsPageComponent).componentInstance;
    const form = { applicablePlanIds: [] as string[] } as never as { applicablePlanIds: string[] };

    component.onApplicablePlansChange(['p1'], form as never);
    expect(form.applicablePlanIds).toEqual(['p1']);
    expect(component.columns.find((column) => column.id === 'eligibility')?.hidden).toBe(true);
    expect(
      component.advantageSummaryLabel({
        advantageType: 'fixed_amount_net',
        advantageConfig: { amountNet: 5 },
      } as never),
    ).toBe('€5.00 net credit');
  });
});
