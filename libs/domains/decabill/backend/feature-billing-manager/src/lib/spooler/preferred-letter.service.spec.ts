import { DeliverableDocumentType } from '../constants/document-delivery.constants';

import { PreferredLetterService } from './preferred-letter.service';

describe('PreferredLetterService', () => {
  const profile = {
    userId: 'user-1',
    company: 'Acme',
    addressLine1: 'Weg 1',
    postalCode: '10115',
    city: 'Berlin',
    country: 'DE',
    preferredDeliveryChannel: 'letter',
  };
  const profiles = { findByUserId: jest.fn() };
  const providers = { getDefaultConfiguredProvider: jest.fn() };
  const spooler = { create: jest.fn() };
  const auditLog = { log: jest.fn() };
  const service = new PreferredLetterService(
    profiles as never,
    providers as never,
    spooler as never,
    auditLog as never,
  );
  const params = {
    documentType: DeliverableDocumentType.INVOICE,
    documentId: 'inv-1',
    documentNumber: 'INV-1',
    userId: 'user-1',
    adminUserId: 'admin-1',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    profiles.findByUserId.mockResolvedValue(profile);
    providers.getDefaultConfiguredProvider.mockReturnValue({ getType: () => 'pingen' });
    spooler.create.mockResolvedValue({ id: 'job-1' });
  });

  it('spools a supplementary letter for customers who prefer letters', async () => {
    await expect(service.sendIfPreferred(params)).resolves.toBe('job-1');

    expect(spooler.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'document.send',
        outputTarget: 'postal',
        documentType: 'invoice',
        documentId: 'inv-1',
        title: 'Invoice INV-1 by letter (customer preference)',
        payload: expect.objectContaining({ channel: 'letter', supplementary: true, adminUserId: 'admin-1' }),
      }),
    );
  });

  it('does nothing for email customers or customers without profile', async () => {
    profiles.findByUserId.mockResolvedValueOnce({ ...profile, preferredDeliveryChannel: 'email' });
    await expect(service.sendIfPreferred(params)).resolves.toBeNull();

    profiles.findByUserId.mockResolvedValueOnce(null);
    await expect(service.sendIfPreferred(params)).resolves.toBeNull();

    expect(spooler.create).not.toHaveBeenCalled();
    expect(auditLog.log).not.toHaveBeenCalled();
  });

  it('skips (audited) without postal provider or postal address', async () => {
    providers.getDefaultConfiguredProvider.mockReturnValueOnce(null);
    await expect(service.sendIfPreferred(params)).resolves.toBeNull();

    profiles.findByUserId.mockResolvedValueOnce({ ...profile, city: '' });
    await expect(service.sendIfPreferred(params)).resolves.toBeNull();

    expect(spooler.create).not.toHaveBeenCalled();
    expect(auditLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ process: 'postal_letter.preferred', level: 'warn', invoiceId: 'inv-1' }),
    );
  });

  it('never throws into the sending flow', async () => {
    spooler.create.mockRejectedValueOnce(new Error('db down'));

    await expect(service.sendIfPreferred(params)).resolves.toBeNull();
    expect(auditLog.log).toHaveBeenCalledWith(expect.objectContaining({ level: 'error' }));
  });
});
