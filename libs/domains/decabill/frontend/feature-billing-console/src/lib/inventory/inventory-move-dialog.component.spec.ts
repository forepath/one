import { TestBed } from '@angular/core/testing';
import {
  AdminBillingService,
  AdminCustomerProfilesService,
  AdminInventoryService,
  AdminOffersService,
  AdminProjectsService,
  AdminSupplierInvoicesService,
  BillingCapabilitiesFacade,
  InventoryFacade,
  type InventoryStock,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { AuthService } from '@forepath/identity/frontend';
import { BehaviorSubject, of } from 'rxjs';

import { InventoryMoveDialogComponent } from './inventory-move-dialog.component';

const stock = (compartmentId: string, quantity: number): InventoryStock =>
  ({
    id: `s-${compartmentId}`,
    quantity,
    article: {
      id: 'a1',
      articleNumber: 'ART-000001',
      name: 'Widget',
      unit: 'piece',
      ean: null,
      isActive: true,
      reorderPoint: null,
    },
    compartment: { id: compartmentId, code: compartmentId.toUpperCase(), name: null, isActive: true },
    warehouse: { id: 'w1', code: 'WH1', name: 'Main', isActive: true },
    updatedAt: '',
  }) as InventoryStock;

describe('InventoryMoveDialogComponent', () => {
  const facade = {
    mutating$: new BehaviorSubject(false),
    mutationError$: new BehaviorSubject<string | null>(null),
    clearError: jest.fn(),
    mutate: jest.fn(),
  };
  const service = {
    listArticleStock: jest.fn().mockReturnValue(of({ items: [stock('c1', 5), stock('c2', 3)], total: 2 })),
    listSerialUnits: jest.fn().mockReturnValue(
      of({
        items: ['LAP-01', 'LAP-02', 'LAP-03'].map((serialNumber) => ({ serialNumber })),
        total: 3,
      }),
    ),
  };

  function create(
    mode: 'putaway' | 'transfer' | 'withdrawal' | 'lending',
    serialTracking = false,
    accountingEnabled = false,
  ) {
    TestBed.configureTestingModule({
      imports: [InventoryMoveDialogComponent],
      providers: [
        { provide: InventoryFacade, useValue: facade },
        { provide: AdminInventoryService, useValue: service },
        { provide: AuthService, useValue: { listUsers: jest.fn().mockReturnValue(of([])) } },
        { provide: AdminBillingService, useValue: {} },
        { provide: AdminOffersService, useValue: {} },
        { provide: AdminSupplierInvoicesService, useValue: {} },
        { provide: AdminProjectsService, useValue: {} },
        { provide: AdminCustomerProfilesService, useValue: {} },
        ...(accountingEnabled
          ? [{ provide: BillingCapabilitiesFacade, useValue: { accountingEnabled$: of(true) } }]
          : []),
      ],
    });

    const fixture = TestBed.createComponent(InventoryMoveDialogComponent);

    fixture.componentRef.setInput('mode', mode);
    fixture.componentRef.setInput('article', {
      id: 'a1',
      articleNumber: 'ART-000001',
      name: 'Widget',
      unit: 'piece',
      serialTracking,
    });
    fixture.componentRef.setInput('presetSource', {
      compartmentId: 'c1',
      compartmentCode: 'C1',
      warehouseCode: 'WH1',
      quantity: 5,
    });
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
    fixtureRef = fixture;

    return fixture.componentInstance;
  }

  let fixtureRef: { detectChanges: () => void } | null = null;

  beforeEach(() => facade.mutate.mockClear());

  it('suggests other compartments but never the source as target', () => {
    const dialog = create('transfer');

    expect(dialog.visibleSuggestions().map((row) => row.compartment.id)).toEqual(['c2']);
    expect(dialog.visibleSuggestionTotal()).toBe(1);
  });

  it('caps the quantity at the source stock and books the transfer', () => {
    const dialog = create('transfer');

    dialog.onSuggestion(stock('c2', 3));
    dialog.quantity = 6;
    expect(dialog.canSubmit()).toBe(false);

    dialog.quantity = 2.5;
    expect(dialog.canSubmit()).toBe(true);
    dialog.submit();

    expect(facade.mutate).toHaveBeenCalledWith({
      kind: 'transfer',
      dto: {
        articleId: 'a1',
        quantity: 2.5,
        reference: null,
        note: null,
        sourceCompartmentId: 'c1',
        targetCompartmentId: 'c2',
      },
    });
  });

  it('withdraws with the chosen reason and needs no target', () => {
    const dialog = create('withdrawal');

    dialog.quantity = 1;
    dialog.reason = 'damage';
    dialog.submit();

    expect(facade.mutate).toHaveBeenCalledWith({
      kind: 'withdraw',
      dto: { articleId: 'a1', quantity: 1, reference: null, note: null, sourceCompartmentId: 'c1', reason: 'damage' },
    });
  });

  it('moves serial-tracked units by serial number: only units in stock at the source, quantity = their count', () => {
    const dialog = create('withdrawal', true);

    expect(service.listSerialUnits).toHaveBeenCalledWith(
      expect.objectContaining({ articleId: 'a1', compartmentId: 'c1', status: 'in_stock' }),
    );
    expect(dialog.availableSerials()).toEqual(['LAP-01', 'LAP-02', 'LAP-03']);

    dialog.serialText.set('LAP-02..LAP-04');
    fixtureRef!.detectChanges();
    expect(dialog.serialSelection().valid).toBe(false);
    expect(dialog.canSubmit()).toBe(false);

    dialog.serialText.set('LAP-01..LAP-02');
    fixtureRef!.detectChanges();
    expect(dialog.canSubmit()).toBe(true);
    dialog.submit();

    expect(facade.mutate).toHaveBeenCalledWith({
      kind: 'withdraw',
      dto: expect.objectContaining({ quantity: 2, serialNumbers: ['LAP-01', 'LAP-02'], sourceCompartmentId: 'c1' }),
    });
  });

  it('lends to a borrower (account or named employee) with an optional due date', () => {
    const dialog = create('lending');

    dialog.quantity = 1;
    expect(dialog.canSubmit()).toBe(false);

    dialog.borrowerMode.set('name');
    dialog.borrowerName = '  Jane Doe ';
    dialog.dueDate = '2001-01-01';
    expect(dialog.canSubmit()).toBe(false);

    dialog.dueDate = '2999-12-31';
    expect(dialog.canSubmit()).toBe(true);
    dialog.submit();

    expect(facade.mutate).toHaveBeenCalledWith({
      kind: 'lend',
      dto: {
        articleId: 'a1',
        quantity: 1,
        reference: null,
        note: null,
        sourceCompartmentId: 'c1',
        borrowerName: 'Jane Doe',
        dueDate: '2999-12-31',
      },
    });

    dialog.borrowerMode.set('account');
    dialog.borrowerUserId.set('u1');
    dialog.dueDate = '';
    dialog.submit();

    expect(facade.mutate).toHaveBeenLastCalledWith({
      kind: 'lend',
      dto: expect.objectContaining({ borrowerUserId: 'u1', dueDate: null }),
    });
  });

  it('putaway: links a supplier invoice picked as reference and sends the unit cost with accounting', () => {
    const dialog = create('putaway', false, true);

    dialog.target.set({ compartmentId: 'c2', compartmentCode: 'C2', warehouseCode: 'WH1' });
    dialog.quantity = 3;
    dialog.onReferenceChange('SUP-2026-00001');
    dialog.onReferencePicked({ kind: 'supplier-invoice', value: 'SUP-2026-00001', detail: null, id: 'si-1' });
    dialog.unitCost = 12.5;
    dialog.submit();

    expect(facade.mutate).toHaveBeenCalledWith({
      kind: 'putaway',
      dto: expect.objectContaining({
        articleId: 'a1',
        quantity: 3,
        reference: 'SUP-2026-00001',
        targetCompartmentId: 'c2',
        supplierInvoiceId: 'si-1',
        unitCost: 12.5,
      }),
    });
  });

  it('putaway: a changed reference drops the supplier invoice link; no unit cost without accounting', () => {
    const dialog = create('putaway');

    dialog.target.set({ compartmentId: 'c2', compartmentCode: 'C2', warehouseCode: 'WH1' });
    dialog.quantity = 1;
    dialog.onReferencePicked({ kind: 'supplier-invoice', value: 'SUP-2026-00001', detail: null, id: 'si-1' });
    dialog.onReferenceChange('DN-4711');
    expect(dialog.supplierInvoice()).toBeNull();

    dialog.unitCost = 9;
    dialog.submit();

    const dto = facade.mutate.mock.calls[0][0].dto;

    expect(dto).not.toHaveProperty('supplierInvoiceId');
    expect(dto).not.toHaveProperty('unitCost');
  });
});
