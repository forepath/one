import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import {
  AdminInventoryService,
  InventoryFacade,
  type InventoryStock,
  type InventoryWithdrawalRequest,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { BehaviorSubject, of } from 'rxjs';

import { InventoryRequestsPageComponent } from './inventory-requests-page.component';

describe('InventoryRequestsPageComponent allocation', () => {
  const facade = {
    requests$: new BehaviorSubject({ items: [], total: 0, loading: false, error: null }),
    summary$: new BehaviorSubject(null),
    mutating$: new BehaviorSubject(false),
    mutationError$: new BehaviorSubject<string | null>(null),
    loadRequests: jest.fn(),
    loadSummary: jest.fn(),
    connectLive: jest.fn(),
    disconnectLive: jest.fn(),
    clearError: jest.fn(),
    mutate: jest.fn(),
  };
  const service = { listArticleStock: jest.fn().mockReturnValue(of({ items: [], total: 0 })) };
  const request = {
    id: 'r1',
    status: 'pending',
    quantity: 5,
    article: { id: 'a1', articleNumber: 'ART-000001', name: 'Widget', unit: 'piece', ean: null },
    sourceLabel: 'INV-2026-00001, pos. 1',
  } as InventoryWithdrawalRequest;
  const stock = (compartmentId: string, quantity: number): InventoryStock =>
    ({
      id: `s-${compartmentId}`,
      quantity,
      article: request.article,
      compartment: { id: compartmentId, code: compartmentId.toUpperCase(), name: null, isActive: true },
      warehouse: { id: 'w1', code: 'WH1', name: 'Main', isActive: true },
    }) as InventoryStock;

  function create() {
    TestBed.configureTestingModule({
      imports: [InventoryRequestsPageComponent],
      providers: [
        { provide: InventoryFacade, useValue: facade },
        { provide: AdminInventoryService, useValue: service },
        { provide: Router, useValue: { navigate: jest.fn(), navigateByUrl: jest.fn() } },
      ],
    });

    return TestBed.runInInjectionContext(() => new InventoryRequestsPageComponent());
  }

  beforeEach(() => facade.mutate.mockClear());

  it('fills suggested sources greedily up to the requested quantity', () => {
    const page = create();

    page.openAccept(request);
    page.addSource(stock('c1', 3));
    page.addSource(stock('c2', 10));

    expect(page.allocations().map((row) => row.quantity)).toEqual([3, 2]);
    expect(page.remaining()).toBe(0);
    expect(page.allocationValid()).toBe(true);
  });

  it('refuses over- and under-allocation and quantities above a compartment stock', () => {
    const page = create();

    page.openAccept(request);
    page.addSource(stock('c1', 3));
    expect(page.allocationValid()).toBe(false);

    page.setQuantity(0, 5);
    expect(page.allocationValid()).toBe(false);

    page.submitAccept();
    expect(facade.mutate).not.toHaveBeenCalled();
  });

  it('submits the allocations', () => {
    const page = create();

    page.openAccept(request);
    page.addSource(stock('c1', 5));
    page.submitAccept();

    expect(facade.mutate).toHaveBeenCalledWith({
      kind: 'acceptRequest',
      id: 'r1',
      allocations: [{ compartmentId: 'c1', quantity: 5 }],
      note: null,
    });
  });
});
