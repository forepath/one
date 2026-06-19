import { InvoiceStatus } from '../constants/invoice-status.constants';
import type { InvoiceEntity } from '../entities/invoice.entity';

import { InvoiceEmailService } from './invoice-email.service';

describe('InvoiceEmailService', () => {
  const emailService = {
    send: jest.fn(),
    isEnabled: jest.fn(),
  };
  const customerProfilesRepository = {
    findByUserId: jest.fn(),
  };
  const usersRepository = {
    findByIdForTenant: jest.fn(),
  };
  const invoicePdfService = {
    readPdf: jest.fn(),
  };
  const service = new InvoiceEmailService(
    emailService as never,
    customerProfilesRepository as never,
    usersRepository as never,
    invoicePdfService as never,
  );
  const invoice = {
    id: 'inv-1',
    userId: 'user-1',
    invoiceNumber: 'INV-2026-00001',
    totalGross: 119,
    currency: 'EUR',
    dueDate: new Date('2026-06-15'),
    status: InvoiceStatus.ISSUED,
  } as InvoiceEntity;
  const pdfBuffer = Buffer.from('pdf');

  beforeEach(() => {
    jest.resetAllMocks();
    customerProfilesRepository.findByUserId.mockResolvedValue({
      userId: 'user-1',
      firstName: 'Jane',
      email: 'jane@example.com',
    });
    invoicePdfService.readPdf.mockResolvedValue(pdfBuffer);
    emailService.send.mockResolvedValue(true);
    emailService.isEnabled.mockReturnValue(true);
  });

  describe('notifyInvoiceIssued', () => {
    it('sends invoice email with PDF attachment', async () => {
      const sent = await service.notifyInvoiceIssued(invoice, 'sub-1/inv-1.pdf');

      expect(sent).toBe(true);
      expect(invoicePdfService.readPdf).toHaveBeenCalledWith('sub-1/inv-1.pdf');
      expect(emailService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'jane@example.com',
          subject: 'Your invoice INV-2026-00001 is ready',
          attachments: [{ filename: 'INV-2026-00001.pdf', content: pdfBuffer }],
        }),
      );
    });

    it('falls back to account email when profile email is missing', async () => {
      customerProfilesRepository.findByUserId.mockResolvedValue({ userId: 'user-1', firstName: 'Jane' });
      usersRepository.findByIdForTenant.mockResolvedValue({ id: 'user-1', email: 'account@example.com' });

      const sent = await service.notifyInvoiceIssued(invoice, 'sub-1/inv-1.pdf');

      expect(sent).toBe(true);
      expect(emailService.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'account@example.com' }));
    });

    it('skips when no recipient email is available', async () => {
      customerProfilesRepository.findByUserId.mockResolvedValue({ userId: 'user-1', firstName: 'Jane' });
      usersRepository.findByIdForTenant.mockResolvedValue({ id: 'user-1' });

      const sent = await service.notifyInvoiceIssued(invoice, 'sub-1/inv-1.pdf');

      expect(sent).toBe(false);
      expect(emailService.send).not.toHaveBeenCalled();
    });
  });

  describe('notifyVoidDocument', () => {
    it('sends credit note email with PDF attachment', async () => {
      const sent = await service.notifyVoidDocument(invoice, 'sub-1/inv-1-void.pdf', 'INV-2026-00001-CN');

      expect(sent).toBe(true);
      expect(emailService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'jane@example.com',
          subject: 'Credit note INV-2026-00001-CN for invoice INV-2026-00001',
          attachments: [{ filename: 'INV-2026-00001-CN.pdf', content: pdfBuffer }],
        }),
      );
    });

    it('skips when invoice number is missing', async () => {
      const sent = await service.notifyVoidDocument(
        { ...invoice, invoiceNumber: undefined } as InvoiceEntity,
        'sub-1/inv-1-void.pdf',
        'INV-2026-00001-CN',
      );

      expect(sent).toBe(false);
      expect(emailService.send).not.toHaveBeenCalled();
    });
  });
});
