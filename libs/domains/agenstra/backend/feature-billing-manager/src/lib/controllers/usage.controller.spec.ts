import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { SubscriptionService } from '../services/subscription.service';
import { UsageService } from '../services/usage.service';

import { UsageController } from './usage.controller';

describe('UsageController', () => {
  let controller: UsageController;
  let usageService: jest.Mocked<Pick<UsageService, 'getLatestUsage' | 'createUsage'>>;
  let subscriptionService: jest.Mocked<Pick<SubscriptionService, 'getSubscription'>>;
  const subscriptionId = '11111111-1111-4111-8111-111111111111';
  const userId = 'user-1';
  const reqWithUser = { user: { id: userId, roles: ['user'] } };

  beforeEach(async () => {
    usageService = {
      getLatestUsage: jest.fn().mockResolvedValue(null),
      createUsage: jest.fn().mockResolvedValue({ id: 'record-1' }),
    };
    subscriptionService = {
      getSubscription: jest.fn().mockResolvedValue({ id: subscriptionId, userId }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [UsageController],
      providers: [
        { provide: UsageService, useValue: usageService },
        { provide: SubscriptionService, useValue: subscriptionService },
      ],
    }).compile();

    controller = moduleRef.get(UsageController);
  });

  describe('summary', () => {
    it('returns usage summary for authenticated user when usage exists', async () => {
      const usage = {
        subscriptionId,
        periodStart: new Date('2025-01-01'),
        periodEnd: new Date('2025-01-31'),
        usagePayload: { requests: 100 },
      };

      usageService.getLatestUsage.mockResolvedValue(usage as never);

      const result = await controller.summary(subscriptionId, reqWithUser as never);

      expect(subscriptionService.getSubscription).toHaveBeenCalledWith(subscriptionId, userId);
      expect(usageService.getLatestUsage).toHaveBeenCalledWith(subscriptionId);
      expect(result).toEqual({
        subscriptionId,
        periodStart: usage.periodStart,
        periodEnd: usage.periodEnd,
        usagePayload: usage.usagePayload,
      });
    });

    it('returns empty usage when no record exists', async () => {
      const result = await controller.summary(subscriptionId, reqWithUser as never);

      expect(subscriptionService.getSubscription).toHaveBeenCalledWith(subscriptionId, userId);
      expect(result).toEqual({
        subscriptionId,
        periodStart: new Date(0),
        periodEnd: new Date(0),
        usagePayload: {},
      });
    });

    it('throws BadRequestException when user not authenticated', async () => {
      await expect(controller.summary(subscriptionId, {} as never)).rejects.toThrow(BadRequestException);
      expect(subscriptionService.getSubscription).not.toHaveBeenCalled();
      expect(usageService.getLatestUsage).not.toHaveBeenCalled();
    });

    it('throws when subscription does not belong to user', async () => {
      subscriptionService.getSubscription.mockRejectedValue(
        new BadRequestException('Subscription does not belong to user'),
      );

      await expect(controller.summary(subscriptionId, reqWithUser as never)).rejects.toThrow(BadRequestException);
      expect(usageService.getLatestUsage).not.toHaveBeenCalled();
    });
  });

  describe('record', () => {
    it('creates usage record when authenticated and subscription belongs to user', async () => {
      const body = {
        subscriptionId,
        periodStart: '2025-01-01T00:00:00.000Z',
        periodEnd: '2025-01-31T23:59:59.999Z',
        usagePayload: { requests: 50 },
      };
      const result = await controller.record(body, reqWithUser as never);

      expect(subscriptionService.getSubscription).toHaveBeenCalledWith(subscriptionId, userId);
      expect(usageService.createUsage).toHaveBeenCalledWith({
        subscriptionId: body.subscriptionId,
        periodStart: new Date(body.periodStart),
        periodEnd: new Date(body.periodEnd),
        usagePayload: body.usagePayload,
        usageSource: 'dataset',
      });
      expect(result).toEqual({ id: 'record-1' });
    });

    it('throws BadRequestException when user not authenticated', async () => {
      const body = {
        subscriptionId,
        periodStart: '2025-01-01T00:00:00.000Z',
        periodEnd: '2025-01-31T23:59:59.999Z',
        usagePayload: {},
      };

      await expect(controller.record(body, {} as never)).rejects.toThrow(BadRequestException);
      expect(subscriptionService.getSubscription).not.toHaveBeenCalled();
      expect(usageService.createUsage).not.toHaveBeenCalled();
    });

    it('throws when subscription does not belong to user', async () => {
      subscriptionService.getSubscription.mockRejectedValue(
        new BadRequestException('Subscription does not belong to user'),
      );
      const body = {
        subscriptionId,
        periodStart: '2025-01-01T00:00:00.000Z',
        periodEnd: '2025-01-31T23:59:59.999Z',
        usagePayload: {},
      };

      await expect(controller.record(body, reqWithUser as never)).rejects.toThrow(BadRequestException);
      expect(usageService.createUsage).not.toHaveBeenCalled();
    });
  });
});
