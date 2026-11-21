import { BadRequestException } from '@nestjs/common';

import { OfferStatus } from '../constants/offer-status.constants';

import { OfferResponseService } from './offer-response.service';

describe('OfferResponseService', () => {
  const offersRepository = { findByIdOrThrow: jest.fn(), claimResponse: jest.fn() };
  const customerProfilesService = { getByUserId: jest.fn(), isProfileComplete: jest.fn() };
  const offerFulfillmentService = { fulfillAcceptedOffer: jest.fn() };
  const billingEmailPublisher = {
    publishOfferAcceptedConfirmation: jest.fn(),
    publishOfferDeclinedConfirmation: jest.fn(),
  };
  const billingNotificationPublisher = { publishOffer: jest.fn() };
  const billingSearchIndexService = { scheduleUpsert: jest.fn() };
  const auditLog = { log: jest.fn() };
  const service = new OfferResponseService(
    offersRepository as never,
    customerProfilesService as never,
    offerFulfillmentService as never,
    billingEmailPublisher as never,
    billingNotificationPublisher as never,
    billingSearchIndexService as never,
    auditLog as never,
  );
  const admin = { kind: 'admin', adminUserId: 'admin-1' } as const;
  const archived = {
    id: 'offer-1',
    userId: 'user-1',
    status: OfferStatus.ARCHIVED,
    offerNumber: 'OFF-1',
    expiresAt: null,
    sentAt: null,
    totalGross: 119,
    currency: 'EUR',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    offersRepository.claimResponse.mockResolvedValue(true);
    customerProfilesService.getByUserId.mockResolvedValue({ id: 'profile-1' });
    customerProfilesService.isProfileComplete.mockReturnValue(true);
    billingEmailPublisher.publishOfferAcceptedConfirmation.mockResolvedValue(true);
    billingEmailPublisher.publishOfferDeclinedConfirmation.mockResolvedValue(true);
  });

  it('records an admin acceptance with confirmation and invoice emails by default', async () => {
    const accepted = { ...archived, status: OfferStatus.ACCEPTED };

    offersRepository.findByIdOrThrow.mockResolvedValue(accepted);

    await expect(service.accept(archived as never, admin)).resolves.toBe(accepted);
    expect(offerFulfillmentService.fulfillAcceptedOffer).toHaveBeenCalledWith('offer-1', {
      skipInvoiceNotification: false,
    });
    expect(billingEmailPublisher.publishOfferAcceptedConfirmation).toHaveBeenCalledWith(accepted);
    expect(billingNotificationPublisher.publishOffer).toHaveBeenCalledWith('offer.accepted', accepted);
    expect(auditLog.log).toHaveBeenCalledWith(
      expect.objectContaining({
        process: 'offer.accept',
        message: 'Admin recorded offer acceptance',
        userId: 'user-1',
        context: expect.objectContaining({
          adminUserId: 'admin-1',
          recordedByAdmin: true,
          notifyCustomer: true,
          notifyInvoices: true,
        }),
      }),
    );
  });

  it('suppresses the confirmation and the invoice emails separately', async () => {
    offersRepository.findByIdOrThrow.mockResolvedValue({ ...archived, status: OfferStatus.ACCEPTED });

    await service.accept(archived as never, admin, { notifyCustomer: false, notifyInvoices: false });

    expect(billingEmailPublisher.publishOfferAcceptedConfirmation).not.toHaveBeenCalled();
    expect(offerFulfillmentService.fulfillAcceptedOffer).toHaveBeenCalledWith('offer-1', {
      skipInvoiceNotification: true,
    });

    jest.clearAllMocks();
    offersRepository.claimResponse.mockResolvedValue(true);

    await service.accept(archived as never, admin, { notifyCustomer: true, notifyInvoices: false });

    expect(billingEmailPublisher.publishOfferAcceptedConfirmation).toHaveBeenCalled();
    expect(offerFulfillmentService.fulfillAcceptedOffer).toHaveBeenCalledWith('offer-1', {
      skipInvoiceNotification: true,
    });
  });

  it('ignores notification options for the customer path (always confirmed, invoices emailed)', async () => {
    offersRepository.findByIdOrThrow.mockResolvedValue({ ...archived, status: OfferStatus.ACCEPTED });

    await service.accept(archived as never, { kind: 'customer' }, { notifyCustomer: false, notifyInvoices: false });

    expect(billingEmailPublisher.publishOfferAcceptedConfirmation).toHaveBeenCalled();
    expect(offerFulfillmentService.fulfillAcceptedOffer).toHaveBeenCalledWith('offer-1', {
      skipInvoiceNotification: false,
    });
  });

  it('applies the customer checks to admins: status, expiry, complete profile', async () => {
    await expect(service.accept({ ...archived, status: OfferStatus.DRAFT } as never, admin)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.accept({ ...archived, status: OfferStatus.REVOKED } as never, admin)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.accept({ ...archived, expiresAt: new Date(Date.now() - 1000) } as never, admin),
    ).rejects.toThrow('Offer has expired');

    customerProfilesService.isProfileComplete.mockReturnValue(false);

    await expect(service.accept(archived as never, admin)).rejects.toThrow(
      'Customer profile must be complete before accepting offer',
    );
    expect(customerProfilesService.getByUserId).toHaveBeenCalledWith('user-1');
    expect(offersRepository.claimResponse).not.toHaveBeenCalled();
    expect(offerFulfillmentService.fulfillAcceptedOffer).not.toHaveBeenCalled();
  });

  it('loses the race cleanly: no fulfillment, email or audit when the claim fails', async () => {
    offersRepository.claimResponse.mockResolvedValue(false);

    await expect(service.accept(archived as never, admin)).rejects.toThrow(
      'Offer cannot be modified in its current status',
    );
    await expect(service.decline(archived as never, admin)).rejects.toBeInstanceOf(BadRequestException);
    expect(offerFulfillmentService.fulfillAcceptedOffer).not.toHaveBeenCalled();
    expect(billingEmailPublisher.publishOfferAcceptedConfirmation).not.toHaveBeenCalled();
    expect(billingEmailPublisher.publishOfferDeclinedConfirmation).not.toHaveBeenCalled();
    expect(auditLog.log).not.toHaveBeenCalled();
  });

  it('records an admin decline with a confirmation email unless suppressed', async () => {
    const declined = { ...archived, status: OfferStatus.DECLINED };

    offersRepository.findByIdOrThrow.mockResolvedValue(declined);

    await service.decline(archived as never, admin);

    expect(billingEmailPublisher.publishOfferDeclinedConfirmation).toHaveBeenCalledWith(declined);
    expect(auditLog.log).toHaveBeenCalledWith(
      expect.objectContaining({
        process: 'offer.decline',
        message: 'Admin recorded offer decline',
        context: expect.objectContaining({ adminUserId: 'admin-1', recordedByAdmin: true, customerNotified: true }),
      }),
    );

    jest.clearAllMocks();
    offersRepository.claimResponse.mockResolvedValue(true);

    await service.decline(archived as never, admin, { notifyCustomer: false });

    expect(billingEmailPublisher.publishOfferDeclinedConfirmation).not.toHaveBeenCalled();
    expect(auditLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ context: expect.objectContaining({ customerNotified: false }) }),
    );
  });

  it('declines expired-but-still-archived offers like the customer can, but nothing else', async () => {
    offersRepository.findByIdOrThrow.mockResolvedValue({ ...archived, status: OfferStatus.DECLINED });

    await expect(
      service.decline({ ...archived, expiresAt: new Date(Date.now() - 1000) } as never, admin),
    ).resolves.toBeDefined();

    for (const status of [OfferStatus.DRAFT, OfferStatus.ACCEPTED, OfferStatus.DECLINED, OfferStatus.REVOKED]) {
      await expect(service.decline({ ...archived, status } as never, admin)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
  });
});
