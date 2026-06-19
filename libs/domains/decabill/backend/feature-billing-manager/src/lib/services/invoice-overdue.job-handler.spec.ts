import { InvoiceStatus } from '../constants/invoice-status.constants';

import { InvoiceOverdueJobHandler } from './invoice-overdue.job-handler';

describe('InvoiceOverdueJobHandler', () => {
  const invoicesRepository = {
    findBatchForOverdueCheck: jest.fn(),
    findById: jest.fn(),
    update: jest.fn(),
  };
  let handler: InvoiceOverdueJobHandler;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.INVOICE_OVERDUE_SCHEDULER_BATCH_SIZE = '50';
    handler = new InvoiceOverdueJobHandler(invoicesRepository as never);
  });

  it('findInvoiceIdsPage returns invoice ids from repository batch', async () => {
    invoicesRepository.findBatchForOverdueCheck.mockResolvedValue([{ id: 'inv-1' }, { id: 'inv-2' }]);

    await expect(handler.findInvoiceIdsPage(0)).resolves.toEqual(['inv-1', 'inv-2']);
    expect(invoicesRepository.findBatchForOverdueCheck).toHaveBeenCalledWith(50, 0);
  });

  it('marks issued invoice overdue when due date is in the past', async () => {
    const yesterday = new Date();

    yesterday.setDate(yesterday.getDate() - 1);

    invoicesRepository.findById.mockResolvedValue({
      id: 'inv-1',
      status: InvoiceStatus.ISSUED,
      dueDate: yesterday,
    });
    invoicesRepository.update.mockResolvedValue({});

    await handler.markOverdueIfNeeded('inv-1');

    expect(invoicesRepository.update).toHaveBeenCalledWith('inv-1', { status: InvoiceStatus.OVERDUE });
  });

  it('does not update paid or void invoices', async () => {
    invoicesRepository.findById.mockResolvedValue({
      id: 'inv-1',
      status: InvoiceStatus.PAID,
      dueDate: new Date('2020-01-01'),
    });

    await handler.markOverdueIfNeeded('inv-1');

    expect(invoicesRepository.update).not.toHaveBeenCalled();
  });

  it('does not update when due date is today or future', async () => {
    const tomorrow = new Date();

    tomorrow.setDate(tomorrow.getDate() + 1);

    invoicesRepository.findById.mockResolvedValue({
      id: 'inv-1',
      status: InvoiceStatus.ISSUED,
      dueDate: tomorrow,
    });

    await handler.markOverdueIfNeeded('inv-1');

    expect(invoicesRepository.update).not.toHaveBeenCalled();
  });
});
