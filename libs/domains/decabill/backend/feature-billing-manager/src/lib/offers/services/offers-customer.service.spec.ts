import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { DeliveryTermsCode } from '../../constants/document-terms.constants';
import { BillingDocumentTermsConfigService } from '../../services/billing-document-terms-config.service';
import { OfferStatus } from '../constants/offer-status.constants';

import { OfferResponseService } from './offer-response.service';
import { OffersCustomerService } from './offers-customer.service';

describe('OffersCustomerService status guards', () => {
  const offersRepository = {
    findByIdOrThrow: jest.fn(),
    countPendingForUser: jest.fn(),
    countByUserAndStatus: jest.fn(),
    update: jest.fn(),
    claimResponse: jest.fn(),
    findPendingByUserId: jest.fn(),
    findHistoryByUserId: jest.fn(),
  };
  const offerLineItemsRepository = { findByOfferId: jest.fn().mockResolvedValue([]) };
  const customerProfilesService = {
    getByUserId: jest.fn(),
    isProfileComplete: jest.fn(),
  };
  const offerArchiveService = { getPdfBuffer: jest.fn() };
  const offerFulfillmentService = { fulfillAcceptedOffer: jest.fn() };
  const billingEmailPublisher = {
    publishOfferAcceptedConfirmation: jest.fn(),
    publishOfferDeclinedConfirmation: jest.fn(),
  };
  const billingNotificationPublisher = { publishOffer: jest.fn() };
  const billingSearchIndexService = { scheduleUpsert: jest.fn() };
  const auditLog = { log: jest.fn() };
  // The real shared accept / decline service: the customer path is tested end to end through it.
  const offerResponseService = new OfferResponseService(
    offersRepository as never,
    customerProfilesService as never,
    offerFulfillmentService as never,
    billingEmailPublisher as never,
    billingNotificationPublisher as never,
    billingSearchIndexService as never,
    auditLog as never,
  );
  const service = new OffersCustomerService(
    offersRepository as never,
    offerLineItemsRepository as never,
    offerArchiveService as never,
    new BillingDocumentTermsConfigService(),
    offerResponseService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    offersRepository.claimResponse.mockResolvedValue(true);
  });

  it('pages the pending offers of the caller (limit / offset / search passed, total returned)', async () => {
    offersRepository.findPendingByUserId.mockResolvedValue({
      items: [
        {
          id: 'offer-1',
          userId: 'user-1',
          status: OfferStatus.ARCHIVED,
          currency: 'EUR',
          totalGross: 119,
          offerNumber: 'OFF-1',
        },
      ],
      total: 12,
    });

    const result = await service.listPending('user-1', 10, 10, 'acme');

    expect(offersRepository.findPendingByUserId).toHaveBeenCalledWith('user-1', {
      limit: 10,
      offset: 10,
      search: 'acme',
    });
    expect(result).toEqual(expect.objectContaining({ total: 12, limit: 10, offset: 10 }));
    expect(result.items.map((item) => item.id)).toEqual(['offer-1']);
  });

  it('pages the offer history of the caller only', async () => {
    offersRepository.findHistoryByUserId.mockResolvedValue({ items: [], total: 0 });

    const result = await service.listHistory('user-1', 25, 0);

    expect(offersRepository.findHistoryByUserId).toHaveBeenCalledWith('user-1', {
      limit: 25,
      offset: 0,
      search: undefined,
    });
    expect(result).toEqual({ items: [], total: 0, limit: 25, offset: 0 });
  });

  it('rejects accept when offer is already accepted', async () => {
    offersRepository.findByIdOrThrow.mockResolvedValue({
      id: 'offer-1',
      userId: 'user-1',
      status: OfferStatus.ACCEPTED,
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      sentAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    await expect(service.accept('user-1', 'offer-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(offersRepository.claimResponse).not.toHaveBeenCalled();
  });

  it('rejects accept when offer belongs to another user', async () => {
    offersRepository.findByIdOrThrow.mockResolvedValue({
      id: 'offer-1',
      userId: 'other-user',
      status: OfferStatus.ARCHIVED,
    });

    await expect(service.accept('user-1', 'offer-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns the offer terms, falling back to the global default for unset facets', async () => {
    offersRepository.findByIdOrThrow.mockResolvedValue({
      id: 'offer-1',
      userId: 'user-1',
      status: OfferStatus.ARCHIVED,
      sentAt: new Date('2026-01-01T00:00:00.000Z'),
      currency: 'EUR',
      subtotalNet: 100,
      taxTotal: 19,
      totalGross: 119,
      billToOpenPositions: false,
      paymentDueDays: null,
      deliveryTermsCode: DeliveryTermsCode.CUSTOM,
      deliveryTermsPlace: null,
      deliveryTermsText: 'Online access',
    });

    const detail = await service.getDetail('user-1', 'offer-1');

    expect(detail).toEqual(
      expect.objectContaining({
        paymentDueDays: 14,
        deliveryTermsCode: DeliveryTermsCode.CUSTOM,
        deliveryTermsPlace: null,
        deliveryTermsText: 'Online access',
      }),
    );
  });

  it('shows archived offers that were not emailed yet, like invoices issued without notification', async () => {
    offersRepository.findByIdOrThrow.mockResolvedValue({
      id: 'offer-1',
      userId: 'user-1',
      status: OfferStatus.ARCHIVED,
      sentAt: null,
      currency: 'EUR',
      subtotalNet: 10,
      taxTotal: 1.9,
      totalGross: 11.9,
      billToOpenPositions: false,
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    });
    offerLineItemsRepository.findByOfferId.mockResolvedValue([]);

    await expect(service.getDetail('user-1', 'offer-1')).resolves.toEqual(
      expect.objectContaining({ id: 'offer-1', status: OfferStatus.ARCHIVED }),
    );
  });

  it('hides draft offers from customer detail', async () => {
    offersRepository.findByIdOrThrow.mockResolvedValue({
      id: 'offer-1',
      userId: 'user-1',
      status: OfferStatus.DRAFT,
    });

    await expect(service.getDetail('user-1', 'offer-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('accepts archived offers that are not expired', async () => {
    const archivedOffer = {
      id: 'offer-1',
      userId: 'user-1',
      status: OfferStatus.ARCHIVED,
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      offerNumber: 'OFF-2026-00001',
      currency: 'EUR',
      subtotalNet: 100,
      taxTotal: 19,
      totalGross: 119,
      billToOpenPositions: false,
      archivedAt: new Date('2026-01-01T00:00:00.000Z'),
      sentAt: new Date('2026-01-01T00:00:00.000Z'),
      acceptedAt: null,
      declinedAt: null,
    };
    const acceptedOffer = {
      ...archivedOffer,
      status: OfferStatus.ACCEPTED,
      acceptedAt: new Date('2026-01-02T00:00:00.000Z'),
    };

    offersRepository.findByIdOrThrow.mockResolvedValueOnce(archivedOffer).mockResolvedValue(acceptedOffer);
    customerProfilesService.getByUserId.mockResolvedValue({ id: 'profile-1' });
    customerProfilesService.isProfileComplete.mockReturnValue(true);

    const result = await service.accept('user-1', 'offer-1');

    expect(result.status).toBe(OfferStatus.ACCEPTED);
    expect(offersRepository.claimResponse).toHaveBeenCalledWith(
      'offer-1',
      expect.objectContaining({ status: OfferStatus.ACCEPTED, acceptedAt: expect.any(Date) }),
    );
    expect(offerFulfillmentService.fulfillAcceptedOffer).toHaveBeenCalledWith('offer-1', {
      skipInvoiceNotification: false,
    });
    expect(billingEmailPublisher.publishOfferAcceptedConfirmation).toHaveBeenCalledWith(acceptedOffer);
    expect(auditLog.log).toHaveBeenCalledWith(
      expect.objectContaining({
        process: 'offer.accept',
        message: 'Customer accepted offer',
        userId: 'user-1',
        context: { offerNumber: 'OFF-2026-00001' },
      }),
    );
  });

  it('accepts an archived offer that was never sent through the system', async () => {
    const unsent = {
      id: 'offer-1',
      userId: 'user-1',
      status: OfferStatus.ARCHIVED,
      expiresAt: null,
      offerNumber: 'OFF-1',
      currency: 'EUR',
      totalGross: 119,
      sentAt: null,
    };

    offersRepository.findByIdOrThrow
      .mockResolvedValueOnce(unsent)
      .mockResolvedValue({ ...unsent, status: OfferStatus.ACCEPTED });
    customerProfilesService.getByUserId.mockResolvedValue({ id: 'profile-1' });
    customerProfilesService.isProfileComplete.mockReturnValue(true);

    await expect(service.accept('user-1', 'offer-1')).resolves.toEqual(
      expect.objectContaining({ status: OfferStatus.ACCEPTED }),
    );
  });

  it('rejects accept when a concurrent answer changed the offer first (fulfills nothing)', async () => {
    offersRepository.findByIdOrThrow.mockResolvedValue({
      id: 'offer-1',
      userId: 'user-1',
      status: OfferStatus.ARCHIVED,
      expiresAt: null,
    });
    customerProfilesService.getByUserId.mockResolvedValue({ id: 'profile-1' });
    customerProfilesService.isProfileComplete.mockReturnValue(true);
    offersRepository.claimResponse.mockResolvedValue(false);

    await expect(service.accept('user-1', 'offer-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(offerFulfillmentService.fulfillAcceptedOffer).not.toHaveBeenCalled();
    expect(billingEmailPublisher.publishOfferAcceptedConfirmation).not.toHaveBeenCalled();
  });

  it('rejects accept of an expired offer and with an incomplete profile', async () => {
    offersRepository.findByIdOrThrow.mockResolvedValue({
      id: 'offer-1',
      userId: 'user-1',
      status: OfferStatus.ARCHIVED,
      expiresAt: new Date('2000-01-01T00:00:00.000Z'),
    });

    await expect(service.accept('user-1', 'offer-1')).rejects.toThrow('Offer has expired');

    offersRepository.findByIdOrThrow.mockResolvedValue({
      id: 'offer-1',
      userId: 'user-1',
      status: OfferStatus.ARCHIVED,
      expiresAt: null,
    });
    customerProfilesService.getByUserId.mockResolvedValue({ id: 'profile-1' });
    customerProfilesService.isProfileComplete.mockReturnValue(false);

    await expect(service.accept('user-1', 'offer-1')).rejects.toThrow(
      'Customer profile must be complete before accepting offer',
    );
    expect(offersRepository.claimResponse).not.toHaveBeenCalled();
  });

  it('declines an archived offer without emailing the customer', async () => {
    const archived = { id: 'offer-1', userId: 'user-1', status: OfferStatus.ARCHIVED, offerNumber: 'OFF-1' };

    offersRepository.findByIdOrThrow
      .mockResolvedValueOnce(archived)
      .mockResolvedValue({ ...archived, status: OfferStatus.DECLINED, totalGross: 1, currency: 'EUR' });

    const result = await service.decline('user-1', 'offer-1');

    expect(result.status).toBe(OfferStatus.DECLINED);
    expect(offersRepository.claimResponse).toHaveBeenCalledWith(
      'offer-1',
      expect.objectContaining({ status: OfferStatus.DECLINED, declinedAt: expect.any(Date) }),
    );
    expect(billingEmailPublisher.publishOfferDeclinedConfirmation).not.toHaveBeenCalled();
    expect(auditLog.log).toHaveBeenCalledWith(
      expect.objectContaining({
        process: 'offer.decline',
        message: 'Customer declined offer',
        context: { offerNumber: 'OFF-1' },
      }),
    );
  });

  it("rejects decline of another customer's offer", async () => {
    offersRepository.findByIdOrThrow.mockResolvedValue({
      id: 'offer-1',
      userId: 'other',
      status: OfferStatus.ARCHIVED,
    });

    await expect(service.decline('user-1', 'offer-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(offersRepository.claimResponse).not.toHaveBeenCalled();
  });
});
