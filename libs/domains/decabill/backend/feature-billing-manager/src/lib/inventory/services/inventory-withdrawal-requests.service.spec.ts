import { BadRequestException, ConflictException } from '@nestjs/common';

import {
  InventoryMovementReason,
  InventoryMovementType,
  InventoryWithdrawalRequestSource,
  InventoryWithdrawalRequestStatus,
} from '../constants/inventory.constants';

import { InventoryWithdrawalRequestsService } from './inventory-withdrawal-requests.service';

describe('InventoryWithdrawalRequestsService', () => {
  const manager = {};
  const dataSource = { transaction: jest.fn((run: (em: unknown) => unknown) => run(manager)) };
  const request = {
    id: 'r1',
    tenantId: 'default',
    articleId: 'a1',
    quantity: '3.000',
    status: InventoryWithdrawalRequestStatus.PENDING,
    sourceType: InventoryWithdrawalRequestSource.INVOICE,
    sourceRef: 'invoice-line:l1',
    sourceLabel: 'INV-2026-00001, pos. 1',
    userId: 'cust1',
    invoiceId: 'i1',
    createdAt: new Date(),
  };
  const requestsRepository = {
    findByIdOrThrow: jest.fn(),
    createIfAbsent: jest.fn(),
    lockPending: jest.fn(),
    decide: jest.fn(),
    findAll: jest.fn(),
  };
  const article = { id: 'a1', articleNumber: 'ART-000001', name: 'Widget', ean: null, unit: 'piece' };
  const articlesRepository = {
    findByIdOrThrow: jest.fn(),
    findByIds: jest.fn(),
    stockTotalsFor: jest.fn(),
  };
  const movementsRepository = { findAll: jest.fn().mockResolvedValue({ items: [], total: 0 }) };
  const movementsService = {
    articleTotal: jest.fn().mockResolvedValue(10),
    book: jest.fn(async (_em: unknown, params: Record<string, unknown>) => ({
      id: `m-${params.sourceCompartmentId}`,
      documentNumber: 'WDR-2026-00001',
      ...params,
    })),
    afterCommit: jest.fn(),
  };
  const usersRepository = { findByIdForTenant: jest.fn().mockResolvedValue({ email: 'customer@example.com' }) };
  const customerProfilesRepository = {
    findByUserId: jest.fn().mockResolvedValue({ customerNumber: 'CUS-000001', company: 'ACME' }),
  };
  const realtime = { requestChanged: jest.fn(), articlesChanged: jest.fn() };
  const auditLog = { log: jest.fn() };
  const notifications = { publish: jest.fn() };
  const service = new InventoryWithdrawalRequestsService(
    dataSource as never,
    requestsRepository as never,
    articlesRepository as never,
    movementsRepository as never,
    movementsService as never,
    usersRepository as never,
    customerProfilesRepository as never,
    realtime as never,
    auditLog as never,
    notifications as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    requestsRepository.findByIdOrThrow.mockResolvedValue(request);
    requestsRepository.lockPending.mockResolvedValue(request);
    articlesRepository.findByIdOrThrow.mockResolvedValue(article);
    articlesRepository.findByIds.mockResolvedValue([article]);
    articlesRepository.stockTotalsFor.mockResolvedValue(new Map([['a1', { totalQuantity: 10, locationCount: 2 }]]));
  });

  it('raises one request per invoice line with an article and never throws', async () => {
    requestsRepository.createIfAbsent.mockResolvedValueOnce(request).mockRejectedValueOnce(new Error('db down'));

    await expect(
      service.raiseForInvoiceLines(
        { id: 'i1', invoiceNumber: 'INV-2026-00001', userId: 'cust1', subscriptionId: null } as never,
        [
          { id: 'l1', position: 0, quantity: '3', inventoryArticleId: 'a1' },
          { id: 'l2', position: 1, quantity: '1', inventoryArticleId: null },
          { id: 'l3', position: 2, quantity: '2', inventoryArticleId: 'a1' },
        ] as never,
      ),
    ).resolves.toBeUndefined();

    expect(requestsRepository.createIfAbsent).toHaveBeenCalledTimes(2);
    expect(requestsRepository.createIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceRef: 'invoice-line:l1',
        sourceLabel: 'INV-2026-00001, pos. 1',
        sourceType: InventoryWithdrawalRequestSource.INVOICE,
        quantity: 3,
      }),
    );
    expect(notifications.publish).toHaveBeenCalledWith('withdrawal_request.created', expect.any(Object), 'cust1');
  });

  it('keys subscription period requests by invoice, subscription and article (idempotent billing runs)', async () => {
    requestsRepository.createIfAbsent.mockResolvedValue(null);

    await service.raiseForSubscriptionPeriod(
      { id: 'i9', invoiceNumber: 'INV-2026-00009', userId: 'cust1' },
      { id: 's1', number: 'SUB-000001' },
      {
        name: 'Plan',
        inventoryArticles: [
          { articleId: 'a1', quantity: 2 },
          { articleId: 'a2', quantity: 0 },
        ],
      },
    );

    expect(requestsRepository.createIfAbsent).toHaveBeenCalledTimes(1);
    expect(requestsRepository.createIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ sourceRef: 'subscription-invoice:i9:s1:a1', subscriptionId: 's1' }),
    );
    // Duplicate (null): no notification.
    expect(notifications.publish).not.toHaveBeenCalled();
  });

  it('accepts by booking one fulfilment withdrawal per allocation', async () => {
    await service.accept(
      'r1',
      {
        allocations: [
          { compartmentId: 'cA', quantity: 1 },
          { compartmentId: 'cB', quantity: 2 },
        ],
      },
      'admin1',
    );

    expect(movementsService.book).toHaveBeenCalledTimes(2);
    expect(movementsService.book).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        type: InventoryMovementType.WITHDRAWAL,
        reason: InventoryMovementReason.FULFILLMENT,
        withdrawalRequestId: 'r1',
        requestSnapshot: expect.objectContaining({ customerNumber: 'CUS-000001', customerName: 'ACME' }),
      }),
    );
    expect(requestsRepository.decide).toHaveBeenCalledWith(
      manager,
      'r1',
      expect.objectContaining({ status: InventoryWithdrawalRequestStatus.ACCEPTED, decidedByUserId: 'admin1' }),
    );
    expect(movementsService.afterCommit).toHaveBeenCalled();
  });

  it('rejects allocations that do not add up to the requested quantity', async () => {
    await expect(service.accept('r1', { allocations: [{ compartmentId: 'cA', quantity: 2.999 }] })).rejects.toThrow(
      BadRequestException,
    );
    expect(movementsService.book).not.toHaveBeenCalled();
  });

  it('rejects duplicate compartments', async () => {
    await expect(
      service.accept('r1', {
        allocations: [
          { compartmentId: 'cA', quantity: 1 },
          { compartmentId: 'cA', quantity: 2 },
        ],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses decisions on requests that are no longer pending (also under concurrency)', async () => {
    requestsRepository.findByIdOrThrow.mockResolvedValueOnce({
      ...request,
      status: InventoryWithdrawalRequestStatus.REJECTED,
    });

    await expect(service.accept('r1', { allocations: [{ compartmentId: 'cA', quantity: 3 }] })).rejects.toThrow(
      ConflictException,
    );

    requestsRepository.lockPending.mockResolvedValueOnce(null);

    await expect(service.accept('r1', { allocations: [{ compartmentId: 'cA', quantity: 3 }] })).rejects.toThrow(
      ConflictException,
    );
    expect(movementsService.book).not.toHaveBeenCalled();

    requestsRepository.lockPending.mockResolvedValueOnce(null);

    await expect(service.reject('r1', {})).rejects.toThrow(ConflictException);
  });

  it('rejects without moving stock', async () => {
    await service.reject('r1', { note: 'out of stock' }, 'admin1');

    expect(requestsRepository.decide).toHaveBeenCalledWith(
      manager,
      'r1',
      expect.objectContaining({ status: InventoryWithdrawalRequestStatus.REJECTED, decisionNote: 'out of stock' }),
    );
    expect(movementsService.book).not.toHaveBeenCalled();
    expect(notifications.publish).toHaveBeenCalledWith('withdrawal_request.rejected', expect.any(Object), 'cust1');
  });
});
