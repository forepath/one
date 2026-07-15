import { UserRole } from '@forepath/identity/backend';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { SubscriptionsRepository } from '../repositories/subscriptions.repository';
import { UsageService } from '../services/usage.service';

import { AdminUsageController } from './admin-usage.controller';

describe('AdminUsageController', () => {
  let controller: AdminUsageController;
  let usageService: jest.Mocked<Pick<UsageService, 'createUsage'>>;
  let subscriptionsRepository: jest.Mocked<Pick<SubscriptionsRepository, 'findByIdOrThrow'>>;
  const subscriptionId = '11111111-1111-4111-8111-111111111111';
  const reqWithAdmin = { user: { id: 'admin-1', roles: [UserRole.ADMIN] } };
  const reqWithUser = { user: { id: 'user-1', roles: ['user'] } };
  const reqWithApiKey = { apiKeyAuthenticated: true } as const;
  const recordBody = {
    subscriptionId,
    periodStart: '2025-01-01T00:00:00.000Z',
    periodEnd: '2025-01-31T23:59:59.999Z',
    usagePayload: { requests: 50 },
  };

  beforeEach(async () => {
    usageService = {
      createUsage: jest.fn().mockResolvedValue({ id: 'record-1' }),
    };
    subscriptionsRepository = {
      findByIdOrThrow: jest.fn().mockResolvedValue({ id: subscriptionId, userId: 'user-1' }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [AdminUsageController],
      providers: [
        { provide: UsageService, useValue: usageService },
        { provide: SubscriptionsRepository, useValue: subscriptionsRepository },
      ],
    }).compile();

    controller = moduleRef.get(AdminUsageController);
  });

  describe('record', () => {
    it('creates usage record for admin on any tenant subscription', async () => {
      const result = await controller.record(recordBody, reqWithAdmin as never);

      expect(subscriptionsRepository.findByIdOrThrow).toHaveBeenCalledWith(subscriptionId);
      expect(usageService.createUsage).toHaveBeenCalledWith({
        subscriptionId: recordBody.subscriptionId,
        periodStart: new Date(recordBody.periodStart),
        periodEnd: new Date(recordBody.periodEnd),
        usagePayload: recordBody.usagePayload,
        usageSource: 'admin',
      });
      expect(result).toEqual({ id: 'record-1' });
    });

    it('creates usage record for api key auth', async () => {
      const result = await controller.record(recordBody, reqWithApiKey as never);

      expect(subscriptionsRepository.findByIdOrThrow).toHaveBeenCalledWith(subscriptionId);
      expect(usageService.createUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionId,
          usageSource: 'api-key',
        }),
      );
      expect(result).toEqual({ id: 'record-1' });
    });

    it('rejects non-admin customers', async () => {
      await expect(controller.record(recordBody, reqWithUser as never)).rejects.toThrow(ForbiddenException);
      expect(subscriptionsRepository.findByIdOrThrow).not.toHaveBeenCalled();
      expect(usageService.createUsage).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when user not authenticated', async () => {
      await expect(controller.record(recordBody, {} as never)).rejects.toThrow(BadRequestException);
      expect(subscriptionsRepository.findByIdOrThrow).not.toHaveBeenCalled();
      expect(usageService.createUsage).not.toHaveBeenCalled();
    });

    it('throws when subscription is not found in tenant', async () => {
      subscriptionsRepository.findByIdOrThrow.mockRejectedValue(new BadRequestException('Subscription not found'));

      await expect(controller.record(recordBody, reqWithAdmin as never)).rejects.toThrow(BadRequestException);
      expect(usageService.createUsage).not.toHaveBeenCalled();
    });
  });
});
