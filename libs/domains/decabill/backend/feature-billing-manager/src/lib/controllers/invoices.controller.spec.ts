import { BadRequestException, NotFoundException, StreamableFile } from '@nestjs/common';
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
    Pick<
      InvoicesRepository,
      'findBySubscription' | 'findOpenOverdueSummaryByUserId' | 'findByIdForUser' | 'findByIdAndSubscriptionId'
    >
  >;
  let invoiceService: jest.Mocked<
    Pick<
      InvoiceService,
      | 'mapToResponse'
      | 'getDetail'
      | 'getDetailForUser'
      | 'getPdfBuffer'
      | 'getPdfBufferForUser'
      | 'getVoidPdfBuffer'
      | 'getVoidPdfBufferForUser'
    >
  >;
  let usersBillingDayRepository: jest.Mocked<Pick<UsersBillingDayRepository, 'getEffectiveBillingDayForUser'>>;
  let invoiceCreationService: jest.Mocked<Pick<InvoiceCreationService, 'getUnbilledTotalForUser'>>;
  let subscriptionService: jest.Mocked<Pick<SubscriptionService, 'getSubscription'>>;
  let subscriptionsRepository: jest.Mocked<Pick<SubscriptionsRepository, 'findByIdOrThrow'>>;
  let paymentOrchestrationService: jest.Mocked<
    Pick<PaymentOrchestrationService, 'initiatePayment' | 'initiatePaymentForUser'>
  >;
  const subscriptionId = '11111111-1111-4111-8111-111111111111';
  const invoiceRefId = '22222222-2222-4222-8222-222222222222';
  const userId = 'user-1';
  const reqWithUser = { user: { id: userId, roles: ['user'] } };

  beforeEach(async () => {
    invoicesRepository = {
      findBySubscription: jest.fn().mockResolvedValue([]),
      findOpenOverdueSummaryByUserId: jest.fn().mockResolvedValue({ count: 0, totalBalance: 0 }),
      findByIdForUser: jest.fn(),
      findByIdAndSubscriptionId: jest.fn(),
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
      getDetailForUser: jest.fn(),
      getPdfBuffer: jest.fn(),
      getPdfBufferForUser: jest.fn(),
      getVoidPdfBuffer: jest.fn(),
      getVoidPdfBufferForUser: jest.fn(),
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
    paymentOrchestrationService = {
      initiatePayment: jest.fn(),
      initiatePaymentForUser: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [InvoicesController],
      providers: [
        { provide: InvoiceService, useValue: invoiceService },
        { provide: InvoiceCreationService, useValue: invoiceCreationService },
        { provide: InvoicesRepository, useValue: invoicesRepository },
        { provide: UsersBillingDayRepository, useValue: usersBillingDayRepository },
        { provide: SubscriptionService, useValue: subscriptionService },
        { provide: PaymentOrchestrationService, useValue: paymentOrchestrationService },
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

  describe('by-ref routes', () => {
    it('getDetailByRef returns detail for authenticated user', async () => {
      const detail = { id: invoiceRefId, subscriptionId: null, status: InvoiceStatus.ISSUED };

      invoiceService.getDetailForUser.mockResolvedValue(detail as never);

      const result = await controller.getDetailByRef(invoiceRefId, reqWithUser as never);

      expect(result).toEqual(detail);
      expect(invoiceService.getDetailForUser).toHaveBeenCalledWith(invoiceRefId, userId);
    });

    it('downloadPdfByRef returns streamable file', async () => {
      const buffer = Buffer.from('pdf');

      invoicesRepository.findByIdForUser.mockResolvedValue({
        id: invoiceRefId,
        invoiceNumber: 'INV-2026-00001',
      } as never);
      invoiceService.getPdfBufferForUser.mockResolvedValue(buffer);

      const result = await controller.downloadPdfByRef(
        invoiceRefId,
        reqWithUser as never,
        {
          setHeader: jest.fn(),
        } as never,
      );

      expect(result).toBeInstanceOf(StreamableFile);
      expect(invoiceService.getPdfBufferForUser).toHaveBeenCalledWith(invoiceRefId, userId);
    });

    it('downloadPdfByRef throws when invoice not found', async () => {
      invoicesRepository.findByIdForUser.mockResolvedValue(null);

      await expect(
        controller.downloadPdfByRef(invoiceRefId, reqWithUser as never, { setHeader: jest.fn() } as never),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('downloadVoidDocumentPdfByRef returns streamable file', async () => {
      const buffer = Buffer.from('void-pdf');

      invoicesRepository.findByIdForUser.mockResolvedValue({
        id: invoiceRefId,
        invoiceNumber: 'INV-2026-00001',
      } as never);
      invoiceService.getVoidPdfBufferForUser.mockResolvedValue(buffer);

      const result = await controller.downloadVoidDocumentPdfByRef(
        invoiceRefId,
        reqWithUser as never,
        {
          setHeader: jest.fn(),
        } as never,
      );

      expect(result).toBeInstanceOf(StreamableFile);
    });

    it('initiatePaymentByRef delegates to payment orchestration', async () => {
      paymentOrchestrationService.initiatePaymentForUser.mockResolvedValue({
        checkoutUrl: 'https://checkout.stripe.com/pay',
      });

      const result = await controller.initiatePaymentByRef(invoiceRefId, reqWithUser as never);

      expect(result.checkoutUrl).toContain('stripe');
      expect(paymentOrchestrationService.initiatePaymentForUser).toHaveBeenCalledWith(invoiceRefId, userId);
    });

    it('throws when user not authenticated on by-ref route', async () => {
      await expect(controller.getDetailByRef(invoiceRefId, {} as never)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('subscription routes', () => {
    it('getDetail returns invoice detail for subscription', async () => {
      const detail = { id: invoiceRefId, subscriptionId, status: InvoiceStatus.ISSUED };

      invoiceService.getDetail.mockResolvedValue(detail as never);

      const result = await controller.getDetail(subscriptionId, invoiceRefId, reqWithUser as never);

      expect(result).toEqual(detail);
      expect(invoiceService.getDetail).toHaveBeenCalledWith(invoiceRefId, subscriptionId);
    });

    it('downloadPdf returns streamable file for subscription invoice', async () => {
      const buffer = Buffer.from('pdf');

      subscriptionsRepository.findByIdOrThrow.mockResolvedValue({ id: subscriptionId, userId } as never);
      invoicesRepository.findByIdAndSubscriptionId.mockResolvedValue({
        id: invoiceRefId,
        invoiceNumber: 'INV-2026-00001',
      } as never);
      invoiceService.getPdfBuffer.mockResolvedValue(buffer);

      const result = await controller.downloadPdf(
        subscriptionId,
        invoiceRefId,
        reqWithUser as never,
        { setHeader: jest.fn() } as never,
      );

      expect(result).toBeInstanceOf(StreamableFile);
    });

    it('downloadVoidDocumentPdf returns streamable file', async () => {
      const buffer = Buffer.from('void');

      subscriptionsRepository.findByIdOrThrow.mockResolvedValue({ id: subscriptionId, userId } as never);
      invoicesRepository.findByIdAndSubscriptionId.mockResolvedValue({
        id: invoiceRefId,
        invoiceNumber: 'INV-2026-00001',
      } as never);
      invoiceService.getVoidPdfBuffer.mockResolvedValue(buffer);

      const result = await controller.downloadVoidDocumentPdf(
        subscriptionId,
        invoiceRefId,
        reqWithUser as never,
        { setHeader: jest.fn() } as never,
      );

      expect(result).toBeInstanceOf(StreamableFile);
    });

    it('initiatePayment delegates to payment orchestration', async () => {
      subscriptionsRepository.findByIdOrThrow.mockResolvedValue({ id: subscriptionId, userId } as never);
      invoicesRepository.findByIdAndSubscriptionId.mockResolvedValue({ id: invoiceRefId } as never);
      paymentOrchestrationService.initiatePayment.mockResolvedValue({
        checkoutUrl: 'https://checkout.stripe.com/pay',
      });

      const result = await controller.initiatePayment(subscriptionId, invoiceRefId, reqWithUser as never);

      expect(result.checkoutUrl).toContain('stripe');
    });
  });
});
