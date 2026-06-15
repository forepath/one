import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { InvoiceStatus } from '../constants/invoice-status.constants';
import { InvoicesRepository } from '../repositories/invoices.repository';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';
import { UsersBillingDayRepository } from '../repositories/users-billing-day.repository';
import { InvoiceCreationService } from '../services/invoice-creation.service';
import { InvoiceService } from '../services/invoice.service';
import { PaymentOrchestrationService } from '../services/payment-orchestration.service';
import { SubscriptionService } from '../services/subscription.service';

import { InvoicesController } from './invoices.controller';

describe('InvoicesController', () => {
  let controller: InvoicesController;
  let invoicesRepository: jest.Mocked<
    Pick<InvoicesRepository, 'findBySubscription' | 'findOpenOverdueSummaryByUserId'>
  >;
  let invoiceService: jest.Mocked<Pick<InvoiceService, 'mapToResponse' | 'getDetail'>>;
  let usersBillingDayRepository: jest.Mocked<Pick<UsersBillingDayRepository, 'getEffectiveBillingDayForUser'>>;
  let invoiceCreationService: jest.Mocked<Pick<InvoiceCreationService, 'getUnbilledTotalForUser'>>;
  let subscriptionService: jest.Mocked<Pick<SubscriptionService, 'getSubscription'>>;
  let subscriptionsRepository: jest.Mocked<Pick<SubscriptionsRepository, 'findByIdOrThrow'>>;
  const subscriptionId = '11111111-1111-4111-8111-111111111111';
  const userId = 'user-1';
  const reqWithUser = { user: { id: userId, roles: ['user'] } };

  beforeEach(async () => {
    invoicesRepository = {
      findBySubscription: jest.fn().mockResolvedValue([]),
      findOpenOverdueSummaryByUserId: jest.fn().mockResolvedValue({ count: 0, totalBalance: 0 }),
    };
    invoiceService = {
      mapToResponse: jest.fn((inv) => ({
        id: inv.id,
        subscriptionId: inv.subscriptionId,
        createdAt: inv.createdAt ?? new Date(),
        canPay: true,
        canDownload: true,
        canPreview: true,
      })),
      getDetail: jest.fn(),
    };
    usersBillingDayRepository = {
      getEffectiveBillingDayForUser: jest.fn().mockResolvedValue(10),
    };
    invoiceCreationService = {
      getUnbilledTotalForUser: jest.fn().mockResolvedValue(0),
    };
    subscriptionService = {
      getSubscription: jest.fn().mockResolvedValue({ id: subscriptionId, userId }),
    };
    subscriptionsRepository = {
      findByIdOrThrow: jest.fn().mockResolvedValue({ id: subscriptionId, userId }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [InvoicesController],
      providers: [
        { provide: InvoiceService, useValue: invoiceService },
        { provide: InvoiceCreationService, useValue: invoiceCreationService },
        { provide: InvoicesRepository, useValue: invoicesRepository },
        { provide: UsersBillingDayRepository, useValue: usersBillingDayRepository },
        { provide: SubscriptionService, useValue: subscriptionService },
        { provide: PaymentOrchestrationService, useValue: { initiatePayment: jest.fn() } },
        { provide: SubscriptionsRepository, useValue: subscriptionsRepository },
      ],
    }).compile();

    controller = moduleRef.get(InvoicesController);
  });

  describe('getSummary', () => {
    it('returns summary for authenticated user', async () => {
      invoicesRepository.findOpenOverdueSummaryByUserId.mockResolvedValue({ count: 2, totalBalance: 50 });
      usersBillingDayRepository.getEffectiveBillingDayForUser.mockResolvedValue(12);
      invoiceCreationService.getUnbilledTotalForUser.mockResolvedValue(10);

      const result = await controller.getSummary(reqWithUser as never);

      expect(result).toEqual({
        openOverdueCount: 2,
        openOverdueTotal: 50,
        billingDayOfMonth: 12,
        unbilledTotal: 10,
      });
    });

    it('throws when user not authenticated', async () => {
      await expect(controller.getSummary({} as never)).rejects.toThrow(BadRequestException);
    });
  });

  describe('list', () => {
    it('lists invoices for subscription', async () => {
      invoicesRepository.findBySubscription.mockResolvedValue([
        {
          id: 'inv-1',
          subscriptionId,
          userId,
          status: InvoiceStatus.ISSUED,
        } as never,
      ]);

      const result = await controller.list(subscriptionId, reqWithUser as never);

      expect(result).toHaveLength(1);
      expect(subscriptionService.getSubscription).toHaveBeenCalledWith(subscriptionId, userId);
    });
  });
});
