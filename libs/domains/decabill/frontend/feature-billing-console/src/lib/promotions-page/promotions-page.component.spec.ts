import { DatePipe } from '@angular/common';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  PromotionsFacade,
  ServicePlansFacade,
  SubscriptionsFacade,
  type PromotionRedemptionResponse,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { of } from 'rxjs';

import { PromotionsPageComponent } from './promotions-page.component';

jest.mock('../billing-country-options', () => ({ getCountryDisplayName: (code: string) => code }));

/** Facade stub: every method returns an empty stream. */
const stub = (overrides: Record<string, unknown> = {}): Record<string, unknown> =>
  new Proxy(overrides, {
    get: (target, key: string) => {
      if (!(key in target)) target[key] = jest.fn(() => of([]));

      return target[key];
    },
  });

const redemption = (id: string, status: string): PromotionRedemptionResponse =>
  ({
    id,
    code: 'WELCOME',
    promotionName: 'Welcome',
    subscriptionId: 'sub-uuid',
    subscriptionNumber: 'SUB-0001',
    redemptionContext: 'new',
    status,
    redeemedAt: '2026-10-01T00:00:00Z',
    advantageSummary: '7 free days',
    validFrom: '2026-10-01T00:00:00Z',
  }) as unknown as PromotionRedemptionResponse;

describe('PromotionsPageComponent (data list)', () => {
  let component: PromotionsPageComponent;
  let promotions: Record<string, jest.Mock>;

  beforeEach(() => {
    promotions = stub() as Record<string, jest.Mock>;
    TestBed.configureTestingModule({
      providers: [
        DatePipe,
        { provide: PromotionsFacade, useValue: promotions },
        { provide: ServicePlansFacade, useValue: stub() },
        { provide: SubscriptionsFacade, useValue: stub() },
      ],
    });
    component = TestBed.runInInjectionContext(() => new PromotionsPageComponent());
  });

  it('switches between the Active and History tables (tabs instead of two lanes)', () => {
    expect(component.activeTab()).toBe('active');
    component.onTabChange('history');
    expect(component.activeTab()).toBe('history');
    component.onTabChange('bogus');
    expect(component.activeTab()).toBe('history');
  });

  it('shows readable redemption states and the subscription number, never the subscription id', () => {
    const state = component.historyColumns[0].state?.(redemption('r1', 'expired'));

    expect(state).toEqual(expect.objectContaining({ label: 'Expired', tone: 'warning' }));
    const values = component.historyColumns.map((column) => column.value?.(redemption('r1', 'active')));

    expect(values).toContain('SUB-0001');
    expect(values).not.toContain('sub-uuid');
  });

  it('loads one server page of the shown tab only (replace-page) and the other tab on switch', () => {
    const appRef = TestBed.inject(ApplicationRef);

    appRef.tick();
    expect(promotions['loadActivePromotions']).toHaveBeenCalledWith({ search: undefined, page: 1, pageSize: 25 });
    expect(promotions['loadRedemptions']).not.toHaveBeenCalled();

    component.activePaging.page.set(2);
    appRef.tick();
    expect(promotions['loadActivePromotions']).toHaveBeenLastCalledWith({ search: undefined, page: 2, pageSize: 25 });

    component.onTabChange('history');
    appRef.tick();
    expect(promotions['loadRedemptions']).toHaveBeenCalledWith({ search: undefined, page: 1, pageSize: 25 });
  });
});
