import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { OfferStatus } from '../constants/offer-status.constants';

import { OffersCustomerService } from './offers-customer.service';

describe('OffersCustomerService status guards', () => {
  const offersRepository = {
    findByIdOrThrow: jest.fn(),
    countPendingForUser: jest.fn(),
    countByUserAndStatus: jest.fn(),
    update: jest.fn(),
    findPendingByUserId: jest.fn(),
    findHistoryByUserId: jest.fn(),
  };
  const offerLineItemsRepository = { findByOfferId: jest.fn().mockResolvedValue([]) };
  const customerProfilesService = {
    getByUserId: jest.fn(),
    isProfileComplete: jest.fn(),
  };
  const offerPdfService = { readPdf: jest.fn() };
  const offerFulfillmentService = { fulfillAcceptedOffer: jest.fn() };
  const billingEmailPublisher = { publishOfferAcceptedConfirmation: jest.fn() };
  const billingNotificationPublisher = { publishOffer: jest.fn() };
  const billingSearchIndexService = { scheduleUpsert: jest.fn() };
  const auditLog = { log: jest.fn() };

  const service = new OffersCustomerService(
    offersRepository as never,
    offerLineItemsRepository as never,
    customerProfilesService as never,
    offerPdfService as never,
    offerFulfillmentService as never,
    billingEmailPublisher as never,
    billingNotificationPublisher as never,
    billingSearchIndexService as never,
    auditLog as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects accept when offer is already accepted', async () => {
    offersRepository.findByIdOrThrow.mockResolvedValue({
      id: 'offer-1',
      userId: 'user-1',
      status: OfferStatus.ACCEPTED,
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    });

    await expect(service.accept('user-1', 'offer-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(offersRepository.update).not.toHaveBeenCalled();
  });

  it('rejects accept when offer belongs to another user', async () => {
    offersRepository.findByIdOrThrow.mockResolvedValue({
      id: 'offer-1',
      userId: 'other-user',
      status: OfferStatus.ARCHIVED,
    });

    await expect(service.accept('user-1', 'offer-1')).rejects.toBeInstanceOf(ForbiddenException);
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
      acceptedAt: null,
      declinedAt: null,
    };
    const acceptedOffer = {
      ...archivedOffer,
      status: OfferStatus.ACCEPTED,
      acceptedAt: new Date('2026-01-02T00:00:00.000Z'),
    };

    offersRepository.findByIdOrThrow.mockResolvedValueOnce(archivedOffer).mockResolvedValueOnce(acceptedOffer);
    customerProfilesService.getByUserId.mockResolvedValue({ id: 'profile-1' });
    customerProfilesService.isProfileComplete.mockReturnValue(true);
    offersRepository.update.mockResolvedValue(acceptedOffer);

    const result = await service.accept('user-1', 'offer-1');

    expect(result.status).toBe(OfferStatus.ACCEPTED);
    expect(offerFulfillmentService.fulfillAcceptedOffer).toHaveBeenCalledWith('offer-1');
  });
});
