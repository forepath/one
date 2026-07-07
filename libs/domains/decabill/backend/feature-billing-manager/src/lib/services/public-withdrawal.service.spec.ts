import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';

import { ProvisioningStatus } from '../entities/subscription-item.entity';
import { SubscriptionStatus } from '../entities/subscription.entity';

import { PublicWithdrawalService } from './public-withdrawal.service';

describe('PublicWithdrawalService', () => {
  const subscriptionsRepository = {
    findByNumberWithBillingProfile: jest.fn(),
  };
  const subscriptionItemsRepository = {
    findBySubscription: jest.fn(),
  };
  const publicWithdrawalRequestsRepository = {
    findActivePendingBySubscriptionId: jest.fn(),
    invalidateExpiredOrConfirmedForSubscription: jest.fn(),
    createRequest: jest.fn(),
    findPendingById: jest.fn(),
    markCodeVerified: jest.fn(),
    markConfirmed: jest.fn(),
  };
  const subscriptionService = {
    executeWithdrawal: jest.fn(),
  };
  const billingIssuerConfig = {
    getConfig: jest.fn(),
  };
  const emailService = {
    sendWithdrawalConfirmationEmail: jest.fn(),
  };

  let service: PublicWithdrawalService;

  const baseDto = {
    subscriptionNumber: 'SUB-000001',
    customerName: 'Jane Doe',
    email: 'billing@example.com',
    company: 'Acme GmbH',
    orderedOn: '2024-01-10',
  };

  beforeEach(() => {
    jest.resetAllMocks();
    service = new PublicWithdrawalService(
      subscriptionsRepository as never,
      subscriptionItemsRepository as never,
      publicWithdrawalRequestsRepository as never,
      subscriptionService as never,
      billingIssuerConfig as never,
      emailService as never,
    );

    subscriptionsRepository.findByNumberWithBillingProfile.mockResolvedValue({
      subscription: { id: 'sub-1', createdAt: new Date('2024-01-10T12:00:00Z') },
      profile: {
        firstName: 'Jane',
        lastName: 'Doe',
        company: 'Acme GmbH',
        email: 'billing@example.com',
      },
    });
    subscriptionItemsRepository.findBySubscription.mockResolvedValue([]);
    emailService.sendWithdrawalConfirmationEmail.mockResolvedValue(true);
  });

  it('returns addressee from billing issuer config', () => {
    billingIssuerConfig.getConfig.mockReturnValue({
      name: 'Acme GmbH',
      vatId: 'DE123',
      addressLine1: 'Street 1',
      postalCode: '10115',
      city: 'Berlin',
      country: 'DE',
      email: 'legal@acme.example',
    });

    expect(service.getAddressee()).toEqual({
      name: 'Acme GmbH',
      lines: ['Street 1', '10115 Berlin', 'Germany'],
      vatId: 'DE123',
      email: 'legal@acme.example',
    });
  });

  it('throws when addressee config is incomplete', () => {
    billingIssuerConfig.getConfig.mockReturnValue({
      name: '',
      vatId: '',
      addressLine1: '',
      postalCode: '',
      city: '',
      country: 'DE',
    });

    expect(() => service.getAddressee()).toThrow(ServiceUnavailableException);
  });

  it('creates a new request and sends email', async () => {
    publicWithdrawalRequestsRepository.findActivePendingBySubscriptionId.mockResolvedValue(null);
    publicWithdrawalRequestsRepository.createRequest.mockResolvedValue({ id: 'req-1' });

    const result = await service.requestWithdrawal(baseDto);

    expect(publicWithdrawalRequestsRepository.createRequest).toHaveBeenCalled();
    expect(emailService.sendWithdrawalConfirmationEmail).toHaveBeenCalled();
    expect(result).toEqual({
      requestId: 'req-1',
      resumed: false,
      resumeStep: 'code',
      message: 'Check your email for a confirmation code.',
    });
  });

  it('resumes active pending request without sending email', async () => {
    publicWithdrawalRequestsRepository.findActivePendingBySubscriptionId.mockResolvedValue({
      id: 'req-existing',
      codeVerifiedAt: null,
    });

    const result = await service.requestWithdrawal(baseDto);

    expect(publicWithdrawalRequestsRepository.createRequest).not.toHaveBeenCalled();
    expect(emailService.sendWithdrawalConfirmationEmail).not.toHaveBeenCalled();
    expect(result.resumed).toBe(true);
    expect(result.resumeStep).toBe('code');
  });

  it('resumes to acknowledge step when code already verified', async () => {
    publicWithdrawalRequestsRepository.findActivePendingBySubscriptionId.mockResolvedValue({
      id: 'req-existing',
      codeVerifiedAt: new Date(),
    });

    const result = await service.requestWithdrawal(baseDto);

    expect(result.resumeStep).toBe('acknowledge');
  });

  it('rejects when profile does not match', async () => {
    await expect(service.requestWithdrawal({ ...baseDto, email: 'wrong@example.com' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects when orderedOn does not match', async () => {
    await expect(service.requestWithdrawal({ ...baseDto, orderedOn: '2024-02-01' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('verifies code and marks request verified', async () => {
    publicWithdrawalRequestsRepository.findPendingById.mockResolvedValue({
      id: 'req-1',
      confirmationCode: 'ABC123',
    });

    const result = await service.verifyWithdrawalCode({ requestId: 'req-1', code: 'ABC123' });

    expect(publicWithdrawalRequestsRepository.markCodeVerified).toHaveBeenCalled();
    expect(result.resumeStep).toBe('acknowledge');
  });

  it('confirms withdrawal after code verification', async () => {
    publicWithdrawalRequestsRepository.findPendingById.mockResolvedValue({
      id: 'req-1',
      subscriptionId: 'sub-1',
      codeVerifiedAt: new Date(),
    });
    subscriptionService.executeWithdrawal.mockResolvedValue({
      subscription: { id: 'sub-1', status: SubscriptionStatus.PENDING_WITHDRAWAL },
    });

    const result = await service.confirmWithdrawal({
      requestId: 'req-1',
      acknowledgeWithdrawal: true,
    });

    expect(subscriptionService.executeWithdrawal).toHaveBeenCalledWith('sub-1');
    expect(publicWithdrawalRequestsRepository.markConfirmed).toHaveBeenCalled();
    expect(result.message).toContain('submitted successfully');
  });

  it('maps withdrawal policy failure to user-facing message', async () => {
    publicWithdrawalRequestsRepository.findPendingById.mockResolvedValue({
      id: 'req-1',
      subscriptionId: 'sub-1',
      codeVerifiedAt: new Date(),
    });
    subscriptionService.executeWithdrawal.mockRejectedValue(
      new BadRequestException('Statutory withdrawal is not available'),
    );

    await expect(service.confirmWithdrawal({ requestId: 'req-1', acknowledgeWithdrawal: true })).rejects.toThrow(
      'Withdrawal is not permitted for this subscription.',
    );
  });

  it('validates receivedOn when deployed', async () => {
    subscriptionItemsRepository.findBySubscription.mockResolvedValue([
      {
        provisioningStatus: ProvisioningStatus.ACTIVE,
        provisionedAt: new Date('2024-02-01T08:00:00Z'),
        createdAt: new Date('2024-02-01T08:00:00Z'),
      },
    ]);

    await expect(service.requestWithdrawal({ ...baseDto, receivedOn: '2024-03-01' })).rejects.toThrow(
      BadRequestException,
    );
  });
});
