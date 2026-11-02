import { HttpErrorResponse } from '@angular/common/http';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import {
  AdminPromotionsService,
  type AdminPromotionResponse,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { of, throwError } from 'rxjs';

import { BillingAdminPromotionSelectComponent } from './billing-admin-promotion-select.component';

const promotion = (code: string, name: string): AdminPromotionResponse =>
  ({ id: `id-${code}`, code, name }) as AdminPromotionResponse;

describe('BillingAdminPromotionSelectComponent', () => {
  let list: jest.Mock;

  const create = (selectedCode = '') => {
    const fixture = TestBed.createComponent(BillingAdminPromotionSelectComponent);

    fixture.componentRef.setInput('inputId', 'promo');
    fixture.componentRef.setInput('selectedCode', selectedCode);
    fixture.detectChanges();

    return { fixture, component: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  };

  beforeEach(() => {
    list = jest
      .fn()
      .mockReturnValue(of({ items: [promotion('SPRING', 'Spring sale')], total: 1, limit: 20, offset: 0 }));
    TestBed.configureTestingModule({
      imports: [BillingAdminPromotionSelectComponent],
      providers: [{ provide: AdminPromotionsService, useValue: { list } }],
    });
  });

  it('renders the typeahead input when nothing is selected', () => {
    const { el } = create();

    expect(el.querySelector('input#promo')).not.toBeNull();
    expect(el.querySelector('fpc-badge')).toBeNull();
  });

  it('searches the admin promotions API with { search, limit: 20 } after 300 ms', fakeAsync(() => {
    const { fixture, component } = create();

    component.onSearchChange(' spr ');

    fixture.detectChanges();
    tick(299);
    expect(list).not.toHaveBeenCalled();
    tick(1);

    expect(list).toHaveBeenCalledWith({ search: 'spr', limit: 20 });
    expect(component.filteredPromotions().map((p) => p.code)).toEqual(['SPRING']);
    expect(component.loading()).toBe(false);
  }));

  it('stores the promotion code (what the offer line API expects) and shows a chip', fakeAsync(() => {
    const { fixture, component, el } = create();

    component.onSearchChange('spr');

    fixture.detectChanges();
    tick(300);
    component.pickPromotion(component.filteredPromotions()[0], new Event('mousedown'));
    fixture.detectChanges();

    expect(component.selectedCode()).toBe('SPRING');
    expect(el.querySelector('fpc-badge')?.textContent).toContain('SPRING');
    expect(el.querySelector('fpc-badge')?.textContent).toContain('Spring sale');
  }));

  it('shows a stored code as the chip without a lookup', () => {
    const { el } = create('WINTER');

    expect(el.querySelector('fpc-badge')?.textContent).toContain('WINTER');
    expect(list).not.toHaveBeenCalled();
  });

  it('clears the selection', () => {
    const { fixture, component, el } = create('WINTER');

    component.clearSelection();
    fixture.detectChanges();

    expect(component.selectedCode()).toBe('');
    expect(el.querySelector('fpc-badge')).toBeNull();
  });

  it('treats other errors as an empty list', fakeAsync(() => {
    list.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    const { fixture, component } = create();

    component.onSearchChange('x');

    fixture.detectChanges();
    tick(300);

    expect(component.filteredPromotions()).toEqual([]);
    expect(component.accessDenied()).toBe(false);
  }));

  it.each([401, 403])('falls back to a plain code input with a hint on %s', (status) =>
    fakeAsync(() => {
      list.mockReturnValue(throwError(() => new HttpErrorResponse({ status })));
      const { fixture, component, el } = create();

      component.onSearchChange('SECRET');

      fixture.detectChanges();
      tick(300);
      fixture.detectChanges();

      expect(component.accessDenied()).toBe(true);
      expect(component.selectedCode()).toBe('SECRET');
      const plain = el.querySelector('input#promo') as HTMLInputElement;

      expect(plain.value).toBe('SECRET');
      expect(el.querySelector('#promo-hint')?.textContent).toContain('Type the promotion code');

      plain.value = 'OTHER';
      plain.dispatchEvent(new Event('input'));
      expect(component.selectedCode()).toBe('OTHER');
    })(),
  );
});
