import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import {
  AdminBillingService,
  AdminCustomerProfilesService,
  AdminOffersService,
  AdminProjectsService,
  AdminSupplierInvoicesService,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { of, throwError } from 'rxjs';

import { InventoryReferenceSelectComponent } from './inventory-reference-select.component';

describe('InventoryReferenceSelectComponent', () => {
  const page = <T>(items: T[]) => of({ items, total: items.length, limit: 5, offset: 0 });
  const billing = {
    listInvoices: jest.fn(() =>
      page([
        { id: 'i1', invoiceNumber: 'INV-2026-00012', customerName: 'ACME' },
        { id: 'i2', invoiceNumber: null },
      ]),
    ),
    listSubscriptions: jest.fn(() => page([{ id: 's1', number: 'SUB-0042', planName: 'Pro', userEmail: 'a@b.c' }])),
  };
  const offers = { list: jest.fn(() => page([{ id: 'o1', offerNumber: 'OFF-2026-00003', userEmail: 'x@y.z' }])) };
  const supplierInvoices = { list: jest.fn(() => throwError(() => new Error('forbidden'))) };
  const projects = { list: jest.fn(() => page([{ id: 'p1', name: 'Office move' }])) };
  const customers = { list: jest.fn(() => page([{ id: 'c1', customerNumber: 'CUS-000123', company: 'ACME' }])) };

  function create() {
    TestBed.configureTestingModule({
      imports: [InventoryReferenceSelectComponent],
      providers: [
        { provide: AdminBillingService, useValue: billing },
        { provide: AdminOffersService, useValue: offers },
        { provide: AdminSupplierInvoicesService, useValue: supplierInvoices },
        { provide: AdminProjectsService, useValue: projects },
        { provide: AdminCustomerProfilesService, useValue: customers },
      ],
    });

    const fixture = TestBed.createComponent(InventoryReferenceSelectComponent);

    fixture.detectChanges();

    return { fixture, select: fixture.componentInstance };
  }

  beforeEach(() => jest.clearAllMocks());

  it('searches all sources in parallel and groups numbered results (a failing source is skipped)', fakeAsync(() => {
    const { fixture, select } = create();

    select.onQuery('acme');
    fixture.detectChanges();
    tick(300);
    fixture.detectChanges();

    expect(billing.listInvoices).toHaveBeenCalledWith({ search: 'acme', limit: 5, offset: 0 });
    expect(select.groups().map((group) => [group.kind, group.options.map((option) => option.value)])).toEqual([
      ['invoice', ['INV-2026-00012']],
      ['offer', ['OFF-2026-00003']],
      ['subscription', ['SUB-0042']],
      ['project', ['Office move']],
      ['customer', ['CUS-000123']],
    ]);
    expect(select.groups()[0]!.options[0]!.detail).toBe('ACME');
  }));

  it('preselects a document and keeps its kind for the chip', () => {
    const { fixture, select } = create();

    select.pick({ kind: 'invoice', value: 'INV-2026-00012', detail: null }, new Event('mousedown'));
    fixture.detectChanges();

    expect(select.value()).toBe('INV-2026-00012');
    expect(select.kind()).toBe('invoice');
    expect(fixture.nativeElement.querySelector('[data-testid="inventory-reference-chip"]').textContent).toContain(
      'INV-2026-00012',
    );
  });

  it('offers "Other" for free text and treats values set from outside as other', () => {
    const { fixture, select } = create();

    select.pickOther('  DN-4711 ', new Event('mousedown'));
    expect(select.value()).toBe('DN-4711');
    expect(select.kind()).toBe('other');

    select.value.set('legacy text');
    expect(select.kind()).toBe('other');

    select.clear();
    fixture.detectChanges();
    expect(select.value()).toBe('');
  });

  it('emits the picked option (with its id) and null for free text / clear', () => {
    const { select } = create();
    const picked: unknown[] = [];

    select.optionPicked.subscribe((option) => picked.push(option));
    select.pick(
      { kind: 'supplier-invoice', value: 'SUP-2026-00001', detail: 'Parts Ltd', id: 'si-1' },
      new Event('mousedown'),
    );
    select.pickOther('DN-4711', new Event('mousedown'));
    select.clear();

    expect(picked).toEqual([
      { kind: 'supplier-invoice', value: 'SUP-2026-00001', detail: 'Parts Ltd', id: 'si-1' },
      null,
      null,
    ]);
  });
});
