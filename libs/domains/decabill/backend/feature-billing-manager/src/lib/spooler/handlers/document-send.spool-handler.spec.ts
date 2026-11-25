import { InvoiceStatus } from '../../constants/invoice-status.constants';
import type { SpoolJobEntity } from '../entities/spool-job.entity';
import { SpoolPermanentError } from '../spool-kind-handler.interface';
import { SpoolJobKind, SpoolJobStatus } from '../spooler.constants';

import { DocumentSendSpoolHandler } from './document-send.spool-handler';

describe('DocumentSendSpoolHandler', () => {
  const claimedAt = new Date('2026-11-25T09:00:00Z');
  const invoice = (patch: Record<string, unknown> = {}) => ({
    id: 'inv-1',
    userId: 'user-1',
    invoiceNumber: 'INV-1',
    status: InvoiceStatus.ISSUED,
    sentAt: claimedAt,
    issuedAt: new Date('2026-11-24T00:00:00Z'),
    timeReportStorageKey: null,
    ...patch,
  });
  const job = (payload: Record<string, unknown>, documentType = 'invoice'): SpoolJobEntity =>
    ({
      id: 'job-1',
      kind: SpoolJobKind.DOCUMENT_SEND,
      status: SpoolJobStatus.PROCESSING,
      documentType,
      documentId: documentType === 'offer' ? 'offer-1' : 'inv-1',
      payload: { documentType, claimedAt: claimedAt.toISOString(), adminUserId: 'admin-1', ...payload },
    }) as unknown as SpoolJobEntity;
  const invoicesRepository = { findByIdOrThrow: jest.fn() };
  const offersRepository = { findByIdOrThrow: jest.fn() };
  const invoiceService = {
    getStoredPdfKey: jest.fn(async () => 'inv.pdf'),
    getStoredVoidDocumentKey: jest.fn(async () => 'inv-cn.pdf'),
    assertInvoiceSendable: jest.fn(),
    assertCreditNoteSendable: jest.fn(),
  };
  const invoicePdfService = { readPdf: jest.fn(async () => Buffer.from('%PDF')) };
  const projectTimeReportService = { getPdfBufferForInvoice: jest.fn(async () => Buffer.from('%PDF-TR')) };
  const offerArchiveService = {
    getStoredPdfKey: jest.fn(async () => 'offer.pdf'),
    assertOfferSendable: jest.fn(),
    afterDelivery: jest.fn(),
  };
  const offerPdfService = { readPdf: jest.fn(async () => Buffer.from('%PDF-O')) };
  const billingEmailPublisher = {
    publishInvoiceIssued: jest.fn(),
    publishVoidDocument: jest.fn(),
    publishOfferArchived: jest.fn(),
  };
  const postalLetterService = { dispatch: jest.fn(async () => ({ externalId: 'ext-1' })) };
  const postalLettersRepository = { findByDocumentClaim: jest.fn() };
  const documentDelivery = { release: jest.fn(), claim: jest.fn(), assertChannelReady: jest.fn() };
  const auditLog = { log: jest.fn() };
  const preferredLetter = { sendIfPreferred: jest.fn() };
  const handler = new DocumentSendSpoolHandler(
    invoicesRepository as never,
    offersRepository as never,
    invoiceService as never,
    invoicePdfService as never,
    projectTimeReportService as never,
    offerArchiveService as never,
    offerPdfService as never,
    billingEmailPublisher as never,
    postalLetterService as never,
    postalLettersRepository as never,
    documentDelivery as never,
    auditLog as never,
    preferredLetter as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    invoicesRepository.findByIdOrThrow.mockResolvedValue(invoice());
    billingEmailPublisher.publishInvoiceIssued.mockResolvedValue(true);
    postalLettersRepository.findByDocumentClaim.mockResolvedValue(null);
  });

  it('emails the invoice with its stored PDF and audits the send', async () => {
    await expect(handler.run(job({ channel: 'email' }))).resolves.toEqual({});

    expect(billingEmailPublisher.publishInvoiceIssued).toHaveBeenCalledWith(invoice(), 'inv.pdf');
    expect(auditLog.log).toHaveBeenCalledWith(expect.objectContaining({ process: 'invoice.send', invoiceId: 'inv-1' }));
  });

  it('fails permanently when no email could be queued', async () => {
    billingEmailPublisher.publishInvoiceIssued.mockResolvedValue(false);

    await expect(handler.run(job({ channel: 'email' }))).rejects.toBeInstanceOf(SpoolPermanentError);
  });

  it('does nothing when the document is no longer claimed by this job', async () => {
    invoicesRepository.findByIdOrThrow.mockResolvedValue(invoice({ sentAt: new Date('2026-11-25T10:00:00Z') }));

    await expect(handler.run(job({ channel: 'email' }))).rejects.toThrow(/no longer waiting/);
    expect(billingEmailPublisher.publishInvoiceIssued).not.toHaveBeenCalled();
  });

  it('submits the invoice and its time report as one letter', async () => {
    invoicesRepository.findByIdOrThrow.mockResolvedValue(invoice({ timeReportStorageKey: 'tr.pdf' }));

    await expect(handler.run(job({ channel: 'letter' }))).resolves.toEqual({ payload: { externalLetterId: 'ext-1' } });

    expect(postalLetterService.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        documentType: 'invoice',
        documentId: 'inv-1',
        documentNumber: 'INV-1',
        claimedAt,
        pdfs: [Buffer.from('%PDF'), Buffer.from('%PDF-TR')],
        adminUserId: 'admin-1',
      }),
    );
    expect(auditLog.log).toHaveBeenCalledWith(expect.objectContaining({ process: 'invoice.send_letter' }));
  });

  it('never submits a letter twice for the same claim (retry after a crash)', async () => {
    postalLettersRepository.findByDocumentClaim.mockResolvedValue({ externalId: 'ext-0' });

    await expect(handler.run(job({ channel: 'letter' }))).resolves.toEqual({ payload: { externalLetterId: 'ext-0' } });
    expect(postalLetterService.dispatch).not.toHaveBeenCalled();
  });

  it('sends credit notes and offers', async () => {
    invoicesRepository.findByIdOrThrow.mockResolvedValue(
      invoice({ status: InvoiceStatus.VOID, sentAt: null, voidDocumentSentAt: claimedAt }),
    );
    billingEmailPublisher.publishVoidDocument.mockResolvedValue(true);
    await handler.run(job({ channel: 'email' }, 'credit_note'));
    expect(billingEmailPublisher.publishVoidDocument).toHaveBeenCalledWith(expect.anything(), 'inv-cn.pdf', 'INV-1-CN');

    offersRepository.findByIdOrThrow.mockResolvedValue({
      id: 'offer-1',
      userId: 'user-1',
      offerNumber: 'OFF-1',
      status: 'archived',
      sentAt: claimedAt,
    });
    await handler.run(job({ channel: 'letter' }, 'offer'));
    expect(postalLetterService.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ documentType: 'offer', pdfs: [Buffer.from('%PDF-O')] }),
    );
    expect(offerArchiveService.afterDelivery).toHaveBeenCalledWith('offer-1');
  });

  it('does not send documents that were voided or revoked while the send waited', async () => {
    invoicesRepository.findByIdOrThrow.mockResolvedValue(invoice({ status: InvoiceStatus.VOID }));
    await expect(handler.run(job({ channel: 'letter' }))).rejects.toThrow(/voided/);

    invoicesRepository.findByIdOrThrow.mockResolvedValue(invoice({ voidDocumentSentAt: claimedAt }));
    await expect(handler.run(job({ channel: 'email' }, 'credit_note'))).rejects.toThrow(/credit note/);

    offersRepository.findByIdOrThrow.mockResolvedValue({ id: 'offer-1', status: 'revoked', sentAt: claimedAt });
    await expect(handler.run(job({ channel: 'letter' }, 'offer'))).rejects.toBeInstanceOf(SpoolPermanentError);

    expect(postalLetterService.dispatch).not.toHaveBeenCalled();
    expect(billingEmailPublisher.publishInvoiceIssued).not.toHaveBeenCalled();
  });

  it('also posts the emailed document for customers who prefer letters', async () => {
    await handler.run(job({ channel: 'email' }));

    expect(preferredLetter.sendIfPreferred).toHaveBeenCalledWith(
      expect.objectContaining({
        documentType: 'invoice',
        documentId: 'inv-1',
        documentNumber: 'INV-1',
        userId: 'user-1',
      }),
    );
  });

  it('sends supplementary letters without a claim and never releases the email claim', async () => {
    // Sent by email at another time: a supplementary letter still goes out.
    invoicesRepository.findByIdOrThrow.mockResolvedValue(invoice({ sentAt: new Date('2026-11-25T08:00:00Z') }));

    await expect(handler.run(job({ channel: 'letter', supplementary: true }))).resolves.toEqual({
      payload: { externalLetterId: 'ext-1' },
    });
    expect(postalLetterService.dispatch).toHaveBeenCalledWith(expect.objectContaining({ supplementary: true }));

    await handler.onAbandoned(job({ channel: 'letter', supplementary: true }));
    expect(documentDelivery.release).not.toHaveBeenCalled();

    const retryPayload = await handler.prepareRetry(job({ channel: 'letter', supplementary: true }));

    expect(documentDelivery.claim).not.toHaveBeenCalled();
    expect(retryPayload['claimedAt']).toBe(claimedAt.toISOString());

    // Still no letter for a voided invoice.
    invoicesRepository.findByIdOrThrow.mockResolvedValue(invoice({ status: InvoiceStatus.VOID }));
    await expect(handler.run(job({ channel: 'letter', supplementary: true }))).rejects.toThrow(/voided/);
  });

  it('rejects malformed payloads', async () => {
    await expect(handler.run(job({ channel: 'fax' }))).rejects.toBeInstanceOf(SpoolPermanentError);
  });

  it('releases its claim when abandoned', async () => {
    await handler.onAbandoned(job({ channel: 'letter' }));

    expect(documentDelivery.release).toHaveBeenCalledWith('invoice', 'inv-1', claimedAt);
  });

  it('claims the still unsent document again before a retry', async () => {
    invoicesRepository.findByIdOrThrow.mockResolvedValue(invoice({ sentAt: null }));
    documentDelivery.claim.mockResolvedValueOnce(true);

    const payload = await handler.prepareRetry(job({ channel: 'letter', externalLetterId: 'old' }));

    expect(invoiceService.assertInvoiceSendable).toHaveBeenCalled();
    expect(documentDelivery.assertChannelReady).toHaveBeenCalledWith('letter', 'user-1');
    expect(payload).not.toHaveProperty('externalLetterId');
    expect(new Date(payload['claimedAt'] as string).getTime()).toBeGreaterThan(claimedAt.getTime());

    documentDelivery.claim.mockResolvedValueOnce(false);
    await expect(handler.prepareRetry(job({ channel: 'letter' }))).rejects.toThrow(/sent meanwhile/);
  });
});
