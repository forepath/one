import { UserRole } from '@forepath/identity/backend';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import { InventoryLendingStatus, InventoryMovementType } from '../constants/inventory.constants';

import { InventoryLendingsService } from './inventory-lendings.service';

describe('InventoryLendingsService', () => {
  const manager = { query: jest.fn() };
  const dataSource = { transaction: jest.fn((run: (em: unknown) => unknown) => run(manager)) };
  const article = { id: 'a1', articleNumber: 'ART-000001', name: 'Laptop', unit: 'piece', serialTracking: true };
  const compartment = { id: 'cA', code: 'A-01', warehouse: { code: 'HQ', name: 'Main' } };
  const lendingRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'l1',
    articleId: 'a1',
    article,
    documentNumber: 'LND-2026-00001',
    quantity: '2.000',
    returnedQuantity: '0.000',
    status: InventoryLendingStatus.OPEN,
    borrowerUserId: 'u-cust',
    borrowerName: 'ACME',
    borrowerEmail: 'cust@example.com',
    borrowerCustomerNumber: 'CUS-1',
    borrowerKind: 'customer',
    sourceCompartmentId: 'cA',
    sourceCompartment: compartment,
    dueDate: '2030-01-01',
    note: null,
    createdAt: new Date('2026-11-17T10:00:00Z'),
    returnedAt: null,
    ...overrides,
  });
  const lendingsRepository = {
    insert: jest.fn(async (_em: unknown, values: Record<string, unknown>) => ({ id: 'l1', ...values })),
    update: jest.fn(),
    lockOpen: jest.fn(),
    findByIdOrThrow: jest.fn(),
    findAll: jest.fn(),
  };
  const articlesRepository = { findByIdOrThrow: jest.fn().mockResolvedValue(article) };
  const compartmentsRepository = { findByIdOrThrow: jest.fn().mockResolvedValue(compartment) };
  const movementsRepository = { findAll: jest.fn().mockResolvedValue({ items: [], total: 0 }) };
  const serialUnits = { serialNumbersWhere: jest.fn().mockResolvedValue(['SN1', 'SN2']) };
  const movementsService = {
    articleTotal: jest.fn().mockResolvedValue(5),
    book: jest.fn(async (_em: unknown, params: Record<string, unknown>) => ({
      id: 'm1',
      documentNumber: params.type === InventoryMovementType.LENDING ? 'LND-2026-00001' : 'RTN-2026-00001',
      quantity: params.quantity,
      serialNumbers: params.serialNumbers ?? null,
      snapshot: { lending: params.lendingSnapshot },
      createdAt: new Date(),
      ...params,
    })),
    afterCommit: jest.fn(),
  };
  const usersRepository = { findByIdForTenant: jest.fn() };
  const customerProfilesRepository = { findByUserId: jest.fn() };
  const realtime = { lendingChanged: jest.fn() };
  const auditLog = { log: jest.fn() };
  const notifications = { publish: jest.fn() };
  const service = new InventoryLendingsService(
    dataSource as never,
    lendingsRepository as never,
    articlesRepository as never,
    compartmentsRepository as never,
    movementsRepository as never,
    serialUnits as never,
    movementsService as never,
    usersRepository as never,
    customerProfilesRepository as never,
    realtime as never,
    auditLog as never,
    notifications as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    lendingsRepository.findByIdOrThrow.mockResolvedValue(lendingRow());
    usersRepository.findByIdForTenant.mockResolvedValue({
      id: 'u-cust',
      email: 'cust@example.com',
      role: UserRole.USER,
    });
    customerProfilesRepository.findByUserId.mockResolvedValue({ company: 'ACME', customerNumber: 'CUS-1' });
  });

  it('lends to a customer: opens the lending, books the LND document with the serials and stamps its number', async () => {
    const result = await service.lend(
      {
        articleId: 'a1',
        sourceCompartmentId: 'cA',
        quantity: 2,
        serialNumbers: ['SN1..SN2'],
        borrowerUserId: 'u-cust',
        dueDate: '2030-01-01',
      },
      'admin1',
    );

    expect(lendingsRepository.insert).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        status: InventoryLendingStatus.OPEN,
        borrowerKind: 'customer',
        borrowerName: 'ACME',
        borrowerCustomerNumber: 'CUS-1',
      }),
    );
    expect(movementsService.book).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        type: InventoryMovementType.LENDING,
        serialNumbers: ['SN1..SN2'],
        lendingId: 'l1',
        sourceCompartmentId: 'cA',
      }),
    );
    expect(lendingsRepository.update).toHaveBeenCalledWith(manager, 'l1', { documentNumber: 'LND-2026-00001' });
    expect(movementsService.afterCommit).toHaveBeenCalled();
    expect(notifications.publish).toHaveBeenCalledWith('inventory_lending.created', expect.any(Object));
    expect(realtime.lendingChanged).toHaveBeenCalled();
    expect(result.outstandingSerialNumbers).toEqual(['SN1', 'SN2']);
    expect(result.overdue).toBe(false);
  });

  it('treats administrators and named employees as staff', async () => {
    usersRepository.findByIdForTenant.mockResolvedValueOnce({
      id: 'u-adm',
      email: 'it@example.com',
      role: UserRole.ADMIN,
    });
    customerProfilesRepository.findByUserId.mockResolvedValueOnce(null);

    await service.lend({ articleId: 'a1', sourceCompartmentId: 'cA', quantity: 1, borrowerUserId: 'u-adm' });

    expect(lendingsRepository.insert).toHaveBeenLastCalledWith(
      manager,
      expect.objectContaining({ borrowerKind: 'staff', borrowerName: 'it@example.com' }),
    );

    await service.lend({ articleId: 'a1', sourceCompartmentId: 'cA', quantity: 1, borrowerName: 'Jane Doe' });

    expect(lendingsRepository.insert).toHaveBeenLastCalledWith(
      manager,
      expect.objectContaining({ borrowerKind: 'staff', borrowerName: 'Jane Doe', borrowerUserId: null }),
    );
  });

  it('needs exactly one borrower, a known user (this tenant) and no due date in the past', async () => {
    await expect(service.lend({ articleId: 'a1', sourceCompartmentId: 'cA', quantity: 1 })).rejects.toThrow(
      BadRequestException,
    );
    await expect(
      service.lend({ articleId: 'a1', sourceCompartmentId: 'cA', quantity: 1, borrowerUserId: 'u', borrowerName: 'X' }),
    ).rejects.toThrow(BadRequestException);

    usersRepository.findByIdForTenant.mockResolvedValueOnce(null);

    await expect(
      service.lend({ articleId: 'a1', sourceCompartmentId: 'cA', quantity: 1, borrowerUserId: 'foreign' }),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.lend({
        articleId: 'a1',
        sourceCompartmentId: 'cA',
        quantity: 1,
        borrowerName: 'Jane',
        dueDate: '2001-01-01',
      }),
    ).rejects.toThrow(/past/);
    expect(movementsService.book).not.toHaveBeenCalled();
  });

  it('returns part of a lending and closes it once everything is back', async () => {
    lendingsRepository.lockOpen.mockResolvedValueOnce({ id: 'l1', quantity: 2, returnedQuantity: 0 });

    await service.returnLending('l1', { targetCompartmentId: 'cA', quantity: 1, serialNumbers: ['SN1'] }, 'admin1');

    expect(movementsService.book).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({ type: InventoryMovementType.LENDING_RETURN, lendingId: 'l1', serialNumbers: ['SN1'] }),
    );
    expect(lendingsRepository.update).toHaveBeenLastCalledWith(manager, 'l1', { returnedQuantity: 1 });

    lendingsRepository.lockOpen.mockResolvedValueOnce({ id: 'l1', quantity: 2, returnedQuantity: 1 });

    await service.returnLending('l1', { targetCompartmentId: 'cA', quantity: 1, serialNumbers: ['SN2'] });

    expect(lendingsRepository.update).toHaveBeenLastCalledWith(manager, 'l1', {
      returnedQuantity: 2,
      status: InventoryLendingStatus.RETURNED,
      returnedAt: expect.any(Date),
    });
    expect(notifications.publish).toHaveBeenCalledWith('inventory_lending.returned', expect.any(Object));
  });

  it('refuses returning more than is on loan, and returns of closed lendings (also when closed concurrently)', async () => {
    lendingsRepository.lockOpen.mockResolvedValueOnce({ id: 'l1', quantity: 2, returnedQuantity: 1.5 });

    await expect(service.returnLending('l1', { targetCompartmentId: 'cA', quantity: 1 })).rejects.toThrow(
      /still on loan/,
    );

    lendingsRepository.lockOpen.mockResolvedValueOnce(null);

    await expect(service.returnLending('l1', { targetCompartmentId: 'cA', quantity: 1 })).rejects.toThrow(
      ConflictException,
    );

    lendingsRepository.findByIdOrThrow.mockResolvedValueOnce(lendingRow({ status: InventoryLendingStatus.RETURNED }));

    await expect(service.returnLending('l1', { targetCompartmentId: 'cA', quantity: 1 })).rejects.toThrow(
      ConflictException,
    );
    expect(movementsService.book).not.toHaveBeenCalled();
  });

  it('flags open lendings past their due date as overdue', async () => {
    lendingsRepository.findByIdOrThrow.mockResolvedValueOnce(lendingRow({ dueDate: '2001-01-01' }));

    expect((await service.get('l1')).overdue).toBe(true);

    lendingsRepository.findByIdOrThrow.mockResolvedValueOnce(
      lendingRow({ dueDate: '2001-01-01', status: InventoryLendingStatus.RETURNED }),
    );

    expect((await service.get('l1')).overdue).toBe(false);
  });
});
