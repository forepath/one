import { BadRequestException } from '@nestjs/common';

import { DeliverableDocumentType, DocumentDeliveryChannel } from '../constants/document-delivery.constants';
import { InvoiceStatus } from '../constants/invoice-status.constants';

import { DocumentDeliveryService } from './document-delivery.service';
import { SpoolJobKind } from './spooler.constants';

describe('DocumentDeliveryService', () => {
  const invoice = {
    id: 'inv-1',
    userId: 'user-1',
    invoiceNumber: 'INV-2026-00001',
    status: InvoiceStatus.ISSUED,
    sentAt: null,
  };
  const spooler = { create: jest.fn() };
  const invoicesRepository = {
    findByIdOrThrow: jest.fn(async () => invoice),
    claimDelivery: jest.fn(),
    releaseDelivery: jest.fn(),
  };
  const offersRepository = {
    findByIdOrThrow: jest.fn(async () => ({ id: 'offer-1', userId: 'user-1', offerNumber: 'OFF-1' })),
    claimSent: jest.fn(),
    releaseSent: jest.fn(),
  };
  const invoiceService = { assertInvoiceSendable: jest.fn(), assertCreditNoteSendable: jest.fn() };
  const offerArchiveService = { assertOfferSendable: jest.fn() };
  const billingEmailPublisher = { hasRecipient: jest.fn() };
  const postalLetterService = { prepare: jest.fn() };
  const service = new DocumentDeliveryService(
    spooler as never,
    invoicesRepository as never,
    offersRepository as never,
    invoiceService as never,
    offerArchiveService as never,
    billingEmailPublisher as never,
    postalLetterService as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    billingEmailPublisher.hasRecipient.mockResolvedValue(true);
    invoicesRepository.claimDelivery.mockResolvedValue(true);
    offersRepository.claimSent.mockResolvedValue(true);
    spooler.create.mockResolvedValue({ id: 'job-1' });
  });

  it('claims the invoice for email and spools the send', async () => {
    const { job } = await service.spoolInvoice('inv-1', DocumentDeliveryChannel.EMAIL, 'admin-1');

    expect(invoiceService.assertInvoiceSendable).toHaveBeenCalledWith(invoice);
    expect(invoicesRepository.claimDelivery).toHaveBeenCalledWith('inv-1', 'sentAt', expect.any(Date), 'email');
    expect(spooler.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: SpoolJobKind.DOCUMENT_SEND,
        outputTarget: 'email',
        title: 'Invoice INV-2026-00001 by email',
        documentType: 'invoice',
        documentId: 'inv-1',
        payload: expect.objectContaining({ documentType: 'invoice', channel: 'email', adminUserId: 'admin-1' }),
      }),
    );
    expect(job).toEqual({ id: 'job-1' });
  });

  it('checks the channel before claiming: no email address / no postal setup sends nothing', async () => {
    billingEmailPublisher.hasRecipient.mockResolvedValueOnce(false);
    await expect(service.spoolInvoice('inv-1', DocumentDeliveryChannel.EMAIL)).rejects.toThrow(/no billing email/);

    postalLetterService.prepare.mockRejectedValueOnce(new BadRequestException('Postal delivery is not configured'));
    await expect(service.spoolInvoice('inv-1', DocumentDeliveryChannel.LETTER)).rejects.toThrow(/not configured/);

    expect(invoicesRepository.claimDelivery).not.toHaveBeenCalled();
    expect(spooler.create).not.toHaveBeenCalled();
  });

  it('refuses a second send when the claim is lost', async () => {
    invoicesRepository.claimDelivery.mockResolvedValueOnce(false);

    await expect(service.spoolInvoice('inv-1', DocumentDeliveryChannel.LETTER)).rejects.toThrow(/already been sent/);
    expect(spooler.create).not.toHaveBeenCalled();
  });

  it('releases the claim when the job cannot be created', async () => {
    spooler.create.mockRejectedValueOnce(new Error('db down'));

    await expect(service.spoolCreditNote('inv-1', DocumentDeliveryChannel.LETTER)).rejects.toThrow('db down');
    expect(invoicesRepository.releaseDelivery).toHaveBeenCalledWith('inv-1', 'voidDocumentSentAt', expect.any(Date));
  });

  it('spools credit notes and offers as letters', async () => {
    await service.spoolCreditNote('inv-1', DocumentDeliveryChannel.LETTER);
    expect(spooler.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ outputTarget: 'postal', title: 'Credit note INV-2026-00001-CN by letter' }),
    );

    await service.spoolOffer('offer-1', DocumentDeliveryChannel.LETTER);
    expect(offerArchiveService.assertOfferSendable).toHaveBeenCalled();
    expect(offersRepository.claimSent).toHaveBeenCalledWith('offer-1', expect.any(Date), 'letter');
    expect(postalLetterService.prepare).toHaveBeenCalledWith('user-1');
  });

  it('claims and releases per document type', async () => {
    const at = new Date();

    await service.claim(DeliverableDocumentType.OFFER, 'offer-1', at, DocumentDeliveryChannel.EMAIL);
    await service.release(DeliverableDocumentType.OFFER, 'offer-1', at);
    await service.release(DeliverableDocumentType.INVOICE, 'inv-1', at);

    expect(offersRepository.claimSent).toHaveBeenCalledWith('offer-1', at, 'email');
    expect(offersRepository.releaseSent).toHaveBeenCalledWith('offer-1', at);
    expect(invoicesRepository.releaseDelivery).toHaveBeenCalledWith('inv-1', 'sentAt', at);
  });
});
