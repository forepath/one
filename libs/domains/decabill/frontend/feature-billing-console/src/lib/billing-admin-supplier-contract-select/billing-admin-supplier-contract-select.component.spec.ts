import { HttpErrorResponse } from '@angular/common/http';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { AdminSupplierProfilesService } from '@forepath/decabill/frontend/data-access-billing-console';
import { of, throwError } from 'rxjs';

import { BillingAdminSupplierContractSelectComponent } from './billing-admin-supplier-contract-select.component';

describe('BillingAdminSupplierContractSelectComponent', () => {
  let listContracts: jest.Mock;

  const create = (selectedContractNumber = '') => {
    const fixture = TestBed.createComponent(BillingAdminSupplierContractSelectComponent);

    fixture.componentRef.setInput('inputId', 'contract');
    fixture.componentRef.setInput('supplierId', 'sup-1');
    fixture.componentRef.setInput('selectedContractNumber', selectedContractNumber);
    fixture.detectChanges();

    return { fixture, component: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  };

  beforeEach(() => {
    listContracts = jest
      .fn()
      .mockReturnValue(of([{ id: 'c1', supplierId: 'sup-1', contractNumber: 'C-100', createdAt: '' }]));
    TestBed.configureTestingModule({
      imports: [BillingAdminSupplierContractSelectComponent],
      providers: [{ provide: AdminSupplierProfilesService, useValue: { listContracts } }],
    });
  });

  it('searches the supplier contracts and stores the contract number', fakeAsync(() => {
    const { fixture, component, el } = create();

    component.onSearchChange('C-1');

    fixture.detectChanges();
    tick(300);

    expect(listContracts).toHaveBeenCalledWith('sup-1', 'C-1');
    component.pickContract(component.filteredContracts()[0], new Event('mousedown'));
    fixture.detectChanges();

    expect(component.selectedContractNumber()).toBe('C-100');
    expect(el.querySelector('fpc-badge')?.textContent).toContain('C-100');
  }));

  it('shows a stored number (an existing draft) as the chip', () => {
    const { el } = create('C-OLD');

    expect(el.querySelector('fpc-badge')?.textContent).toContain('C-OLD');
  });

  it('clears the selection', () => {
    const { fixture, component, el } = create('C-OLD');

    component.clearSelection();
    fixture.detectChanges();

    expect(component.selectedContractNumber()).toBe('');
    expect(el.querySelector('fpc-badge')).toBeNull();
  });

  it('falls back to a plain input with a hint on 403', fakeAsync(() => {
    listContracts.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403 })));
    const { fixture, component, el } = create();

    component.onSearchChange('C-9');

    fixture.detectChanges();
    tick(300);
    fixture.detectChanges();

    expect(component.accessDenied()).toBe(true);
    expect((el.querySelector('input#contract') as HTMLInputElement).value).toBe('C-9');
    expect(el.querySelector('#contract-hint')).not.toBeNull();
  }));
});
