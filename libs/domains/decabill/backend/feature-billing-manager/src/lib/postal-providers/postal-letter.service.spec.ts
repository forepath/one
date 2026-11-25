import { runWithTenantId } from '@forepath/shared/backend/util-http-context';
import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';

import { DeliverableDocumentType } from '../constants/document-delivery.constants';
import { canTransitionPostalLetter, PostalLetterStatus } from '../constants/postal-letter.constants';
import type { CustomerProfileEntity } from '../entities/customer-profile.entity';
import type { PostalLetterEntity } from '../entities/postal-letter.entity';

import { buildPostalRecipient, PostalLetterService, postalIdempotencyKey } from './postal-letter.service';
import { PostalProviderError } from './postal-provider.interface';

describe('canTransitionPostalLetter', () => {
  it('moves forward only and keeps terminal states', () => {
    expect(canTransitionPostalLetter(PostalLetterStatus.SUBMITTED, PostalLetterStatus.SENT)).toBe(true);
    expect(canTransitionPostalLetter(PostalLetterStatus.ACTION_REQUIRED, PostalLetterStatus.SENT)).toBe(true);
    expect(canTransitionPostalLetter(PostalLetterStatus.SENT, PostalLetterStatus.ACTION_REQUIRED)).toBe(false);
    expect(canTransitionPostalLetter(PostalLetterStatus.DELIVERED, PostalLetterStatus.SENT)).toBe(false);
    expect(canTransitionPostalLetter(PostalLetterStatus.UNDELIVERABLE, PostalLetterStatus.DELIVERED)).toBe(false);
    expect(canTransitionPostalLetter(PostalLetterStatus.SENT, PostalLetterStatus.SENT)).toBe(false);
  });
});

describe('buildPostalRecipient', () => {
  const profile = {
    company: 'Acme GmbH',
    firstName: 'Jane',
    lastName: 'Doe',
    addressLine1: 'Hauptstr. 1',
    addressLine2: 'Hinterhaus',
    postalCode: '10115',
    city: 'Berlin',
    country: 'de',
  } as CustomerProfileEntity;

  it('builds company + contact, street lines and normalizes the country', () => {
    expect(buildPostalRecipient(profile)).toEqual({
      nameLines: ['Acme GmbH', 'Jane Doe'],
      streetLines: ['Hauptstr. 1', 'Hinterhaus'],
      postalCode: '10115',
      city: 'Berlin',
      country: 'DE',
    });
  });

  it.each([
    ['no name', { company: '', firstName: '', lastName: '' }],
    ['no street', { addressLine1: ' ' }],
    ['no city', { city: undefined }],
    ['an invalid country', { country: 'Germany' }],
  ])('is null with %s', (_label, patch) => {
    expect(buildPostalRecipient({ ...profile, ...patch } as CustomerProfileEntity)).toBeNull();
  });
});

describe('PostalLetterService', () => {
  const env = process.env;
  const provider = {
    getType: () => 'pingen',
    getDisplayName: () => 'Pingen',
    isConfigured: jest.fn(() => true),
    printsDuplex: jest.fn(() => false),
    sendLetter: jest.fn(),
    getWebhookSignatureHeader: () => 'signature',
    extractWebhookLetterId: jest.fn(),
    verifyWebhookSignature: jest.fn(),
    parseWebhookEvent: jest.fn(),
  };
  const providers = {
    getDefaultConfiguredProvider: jest.fn(() => provider),
    findProvider: jest.fn((type: string) => (type === 'pingen' ? provider : null)),
  };
  const documents = { build: jest.fn() };
  const postalLettersRepository = {
    create: jest.fn(async (dto: Partial<PostalLetterEntity>) => ({ id: 'letter-1', ...dto })),
    findByProviderExternalId: jest.fn(),
    transitionStatus: jest.fn(),
  };
  const customerProfilesRepository = { findByUserId: jest.fn() };
  const invoicesRepository = { releaseDelivery: jest.fn(), claimDelivery: jest.fn() };
  const offersRepository = { releaseSent: jest.fn(), claimSent: jest.fn() };
  const issuerConfig = {
    assertConfigured: jest.fn(),
    getConfig: jest.fn(() => ({ name: 'Issuer', addressLine1: 'Weg 1', postalCode: '1', city: 'X', country: 'DE' })),
  };
  const auditLog = { log: jest.fn() };
  const service = new PostalLetterService(
    providers as never,
    documents as never,
    postalLettersRepository as never,
    customerProfilesRepository as never,
    invoicesRepository as never,
    offersRepository as never,
    issuerConfig as never,
    auditLog as never,
  );
  const claimedAt = new Date('2026-11-25T09:00:00Z');
  const letter = (status: PostalLetterStatus, documentType = DeliverableDocumentType.INVOICE): PostalLetterEntity =>
    ({
      id: 'letter-1',
      tenantId: 'tenant-b',
      userId: 'user-1',
      documentType,
      documentId: 'doc-1',
      documentNumber: 'INV-1',
      provider: 'pingen',
      externalId: 'ext-1',
      status,
      claimedAt,
    }) as PostalLetterEntity;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...env };
    customerProfilesRepository.findByUserId.mockResolvedValue({
      company: 'Acme',
      addressLine1: 'Hauptstr. 1',
      postalCode: '10115',
      city: 'Berlin',
      country: 'DE',
    });
    documents.build.mockResolvedValue({ pdf: Buffer.from('%PDF'), pageCount: 3, coverPage: true });
    provider.sendLetter.mockResolvedValue({ externalId: 'ext-1', status: PostalLetterStatus.SUBMITTED, pageCount: 3 });
    postalLettersRepository.transitionStatus.mockResolvedValue(true);
  });

  afterAll(() => {
    process.env = env;
  });

  describe('prepare / dispatch', () => {
    it('requires a configured provider and a complete postal address', async () => {
      providers.getDefaultConfiguredProvider.mockReturnValueOnce(null as never);
      await expect(service.prepare('user-1')).rejects.toThrow(/not configured/);

      customerProfilesRepository.findByUserId.mockResolvedValueOnce({ company: 'Acme' });
      await expect(service.prepare('user-1')).rejects.toThrow(/no complete postal address/);
    });

    it('builds the letter (cover page by default, left window) and records it in the tenant', async () => {
      const saved = await runWithTenantId('tenant-a', () =>
        service.dispatch({
          documentType: DeliverableDocumentType.INVOICE,
          documentId: 'inv-1',
          documentNumber: 'INV/2026 1',
          userId: 'user-1',
          pdfs: [Buffer.from('%PDF')],
          claimedAt,
          adminUserId: 'admin-1',
        }),
      );

      expect(documents.build).toHaveBeenCalledWith(
        expect.objectContaining({
          coverPage: true,
          addressPosition: 'left',
          duplex: false,
          documentTitle: 'Invoice',
          returnAddress: true,
        }),
      );
      expect(provider.sendLetter).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: 'INV_2026_1.pdf',
          idempotencyKey: postalIdempotencyKey('invoice', 'inv-1', claimedAt),
        }),
      );
      // Stable per delivery claim, different for another claim.
      expect(postalIdempotencyKey('invoice', 'inv-1', claimedAt)).toMatch(/^[0-9a-f]{64}$/);
      expect(postalIdempotencyKey('invoice', 'inv-1', new Date(claimedAt.getTime() + 1))).not.toBe(
        postalIdempotencyKey('invoice', 'inv-1', claimedAt),
      );
      expect(saved).toEqual(
        expect.objectContaining({ tenantId: 'tenant-a', externalId: 'ext-1', status: 'submitted', claimedAt }),
      );
      expect(auditLog.log).toHaveBeenCalledWith(expect.objectContaining({ process: 'postal_letter.submit' }));
    });

    it('honours the cover page and address position settings', async () => {
      process.env.BILLING_POSTAL_COVER_PAGE = 'false';
      process.env.BILLING_POSTAL_ADDRESS_POSITION = 'right';

      await runWithTenantId('tenant-a', () =>
        service.dispatch({
          documentType: DeliverableDocumentType.OFFER,
          documentId: 'offer-1',
          documentNumber: 'OFF-1',
          userId: 'user-1',
          pdfs: [Buffer.from('%PDF')],
          claimedAt,
        }),
      );

      expect(documents.build).toHaveBeenCalledWith(
        expect.objectContaining({ coverPage: false, addressPosition: 'right', documentTitle: 'Offer' }),
      );
    });

    it('rethrows rejections as client errors and transient failures as retryable errors', async () => {
      const params = {
        documentType: DeliverableDocumentType.INVOICE,
        documentId: 'inv-1',
        documentNumber: 'INV-1',
        userId: 'user-1',
        pdfs: [Buffer.from('%PDF')],
        claimedAt,
      };

      provider.sendLetter.mockRejectedValueOnce(new PostalProviderError('invalid', false));
      await expect(runWithTenantId('tenant-a', () => service.dispatch(params))).rejects.toBeInstanceOf(
        BadRequestException,
      );

      provider.sendLetter.mockRejectedValueOnce(new PostalProviderError('timeout', true));
      const transient = await runWithTenantId('tenant-a', () => service.dispatch(params)).catch((error) => error);

      expect(transient).toBeInstanceOf(Error);
      expect(transient).not.toBeInstanceOf(BadRequestException);
      expect(postalLettersRepository.create).not.toHaveBeenCalled();
    });
  });

  describe('handleWebhook', () => {
    beforeEach(() => {
      provider.extractWebhookLetterId.mockReturnValue('ext-1');
      provider.verifyWebhookSignature.mockReturnValue(true);
    });

    it('rejects unknown providers and ignores unknown letters', async () => {
      await expect(service.handleWebhook('other', '{}', {})).rejects.toBeInstanceOf(NotFoundException);

      postalLettersRepository.findByProviderExternalId.mockResolvedValue(null);
      await expect(service.handleWebhook('pingen', '{}', {})).resolves.toBe('ignored');
      expect(provider.verifyWebhookSignature).not.toHaveBeenCalled();
    });

    it("verifies the signature in the letter's tenant before applying anything", async () => {
      postalLettersRepository.findByProviderExternalId.mockResolvedValue(letter(PostalLetterStatus.SUBMITTED));
      provider.verifyWebhookSignature.mockImplementation(() => {
        expect(process.env).toBeDefined();

        return false;
      });

      await expect(service.handleWebhook('pingen', '{}', { signature: 'bad' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(provider.verifyWebhookSignature).toHaveBeenCalledWith('{}', 'bad');
      expect(postalLettersRepository.transitionStatus).not.toHaveBeenCalled();
    });

    it('releases the document claim when the provider needs action, and claims it again once sent', async () => {
      postalLettersRepository.findByProviderExternalId.mockResolvedValue(letter(PostalLetterStatus.SUBMITTED));
      provider.parseWebhookEvent.mockReturnValue({
        externalLetterId: 'ext-1',
        status: PostalLetterStatus.ACTION_REQUIRED,
        reason: 'Address not found',
      });
      invoicesRepository.releaseDelivery.mockResolvedValue(true);

      await expect(service.handleWebhook('pingen', '{}', { signature: 'ok' })).resolves.toBe('processed');
      expect(postalLettersRepository.transitionStatus).toHaveBeenCalledWith(
        'letter-1',
        'submitted',
        'action_required',
        'Address not found',
      );
      expect(invoicesRepository.releaseDelivery).toHaveBeenCalledWith('doc-1', 'sentAt', claimedAt);
      expect(auditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ level: 'warn', process: 'postal_letter.status' }),
      );

      postalLettersRepository.findByProviderExternalId.mockResolvedValue(letter(PostalLetterStatus.ACTION_REQUIRED));
      provider.parseWebhookEvent.mockReturnValue({ externalLetterId: 'ext-1', status: PostalLetterStatus.SENT });
      await service.handleWebhook('pingen', '{}', { signature: 'ok' });
      expect(invoicesRepository.claimDelivery).toHaveBeenCalledWith('doc-1', 'sentAt', claimedAt, 'letter');
    });

    it('never touches the document for supplementary letters (customer preference)', async () => {
      postalLettersRepository.findByProviderExternalId.mockResolvedValue({
        ...letter(PostalLetterStatus.SUBMITTED),
        supplementary: true,
      });
      provider.parseWebhookEvent.mockReturnValue({
        externalLetterId: 'ext-1',
        status: PostalLetterStatus.ACTION_REQUIRED,
      });

      await expect(service.handleWebhook('pingen', '{}', {})).resolves.toBe('processed');
      expect(invoicesRepository.releaseDelivery).not.toHaveBeenCalled();
      expect(auditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ context: expect.objectContaining({ supplementary: true, documentEffect: null }) }),
      );
    });

    it('releases credit note and offer claims on cancellation', async () => {
      provider.parseWebhookEvent.mockReturnValue({ externalLetterId: 'ext-1', status: PostalLetterStatus.CANCELLED });

      postalLettersRepository.findByProviderExternalId.mockResolvedValue(
        letter(PostalLetterStatus.SUBMITTED, DeliverableDocumentType.CREDIT_NOTE),
      );
      await service.handleWebhook('pingen', '{}', {});
      expect(invoicesRepository.releaseDelivery).toHaveBeenCalledWith('doc-1', 'voidDocumentSentAt', claimedAt);

      postalLettersRepository.findByProviderExternalId.mockResolvedValue(
        letter(PostalLetterStatus.SUBMITTED, DeliverableDocumentType.OFFER),
      );
      await service.handleWebhook('pingen', '{}', {});
      expect(offersRepository.releaseSent).toHaveBeenCalledWith('doc-1', claimedAt);
    });

    it('ignores replays, backwards moves and events for another letter', async () => {
      postalLettersRepository.findByProviderExternalId.mockResolvedValue(letter(PostalLetterStatus.DELIVERED));
      provider.parseWebhookEvent.mockReturnValue({ externalLetterId: 'ext-1', status: PostalLetterStatus.SENT });
      await expect(service.handleWebhook('pingen', '{}', {})).resolves.toBe('ignored');

      postalLettersRepository.findByProviderExternalId.mockResolvedValue(letter(PostalLetterStatus.SUBMITTED));
      provider.parseWebhookEvent.mockReturnValue({ externalLetterId: 'ext-2', status: PostalLetterStatus.SENT });
      await expect(service.handleWebhook('pingen', '{}', {})).resolves.toBe('ignored');

      provider.parseWebhookEvent.mockReturnValue({ externalLetterId: 'ext-1', status: PostalLetterStatus.SENT });
      postalLettersRepository.transitionStatus.mockResolvedValue(false);
      await expect(service.handleWebhook('pingen', '{}', {})).resolves.toBe('ignored');
      expect(invoicesRepository.releaseDelivery).not.toHaveBeenCalled();
    });
  });

  it('reports availability of the default provider', () => {
    expect(service.getAvailability()).toEqual({ available: true, provider: 'pingen', providerName: 'Pingen' });
    providers.getDefaultConfiguredProvider.mockReturnValueOnce(null as never);
    expect(service.getAvailability()).toEqual({ available: false, provider: null, providerName: null });
  });
});
