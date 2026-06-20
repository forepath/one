import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { BackorderStatus } from '../entities/backorder.entity';
import { BackordersRepository } from '../repositories/backorders.repository';
import { BackorderService } from '../services/backorder.service';

import { BackordersController } from './backorders.controller';

describe('BackordersController', () => {
  let controller: BackordersController;
  let backorderService: jest.Mocked<Pick<BackorderService, 'listForUser' | 'retry' | 'cancel'>>;
  let backordersRepository: jest.Mocked<Pick<BackordersRepository, 'findByIdOrThrow'>>;
  const backorderId = '22222222-2222-4222-8222-222222222222';
  const userId = 'user-1';
  const otherUserId = 'user-2';
  const reqWithUser = { user: { id: userId, roles: ['user'] } };
  const reqWithAdmin = { user: { id: 'admin-1', roles: ['admin'] } };
  const backorderOwnedByUser = {
    id: backorderId,
    userId,
    serviceTypeId: 'st-1',
    planId: 'plan-1',
    status: BackorderStatus.PENDING,
    requestedConfigSnapshot: {},
    providerErrors: {},
    preferredAlternatives: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const backorderOwnedByOther = {
    ...backorderOwnedByUser,
    userId: otherUserId,
  };

  beforeEach(async () => {
    backorderService = {
      listForUser: jest.fn().mockResolvedValue([]),
      retry: jest.fn().mockResolvedValue(backorderOwnedByUser),
      cancel: jest.fn().mockResolvedValue({ ...backorderOwnedByUser, status: BackorderStatus.CANCELLED }),
    };
    backordersRepository = {
      findByIdOrThrow: jest.fn().mockResolvedValue(backorderOwnedByUser),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [BackordersController],
      providers: [
        { provide: BackorderService, useValue: backorderService },
        { provide: BackordersRepository, useValue: backordersRepository },
      ],
    }).compile();

    controller = moduleRef.get(BackordersController);
  });

  describe('list', () => {
    it('returns backorders for authenticated user', async () => {
      backorderService.listForUser.mockResolvedValue([backorderOwnedByUser] as never);
      const result = await controller.list(10, 0, reqWithUser as never);

      expect(backorderService.listForUser).toHaveBeenCalledWith(userId, 10, 0);
      expect(result).toHaveLength(1);
    });

    it('throws BadRequestException when user not authenticated', async () => {
      await expect(controller.list(10, 0, {} as never)).rejects.toThrow(BadRequestException);
      expect(backorderService.listForUser).not.toHaveBeenCalled();
    });
  });

  describe('retry', () => {
    it('retries when backorder belongs to user', async () => {
      const result = await controller.retry(backorderId, {} as never, reqWithUser as never);

      expect(backordersRepository.findByIdOrThrow).toHaveBeenCalledWith(backorderId);
      expect(backorderService.retry).toHaveBeenCalledWith(backorderId);
      expect(result.userId).toBe(userId);
    });

    it('throws BadRequestException when user not authenticated', async () => {
      await expect(controller.retry(backorderId, {} as never, {} as never)).rejects.toThrow(BadRequestException);
      expect(backorderService.retry).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when backorder belongs to another user and caller is not admin', async () => {
      backordersRepository.findByIdOrThrow.mockResolvedValue(backorderOwnedByOther as never);

      await expect(controller.retry(backorderId, {} as never, reqWithUser as never)).rejects.toThrow(
        ForbiddenException,
      );
      expect(backorderService.retry).not.toHaveBeenCalled();
    });

    it('allows admin to retry another user backorder', async () => {
      backordersRepository.findByIdOrThrow.mockResolvedValue(backorderOwnedByOther as never);
      backorderService.retry.mockResolvedValue(backorderOwnedByOther as never);

      const result = await controller.retry(backorderId, {} as never, reqWithAdmin as never);

      expect(backorderService.retry).toHaveBeenCalledWith(backorderId);
      expect(result.userId).toBe(otherUserId);
    });

    it('throws NotFoundException when backorder does not exist', async () => {
      backordersRepository.findByIdOrThrow.mockRejectedValue(new NotFoundException('Backorder not found'));
      await expect(controller.retry(backorderId, {} as never, reqWithUser as never)).rejects.toThrow(NotFoundException);
      expect(backorderService.retry).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('cancels when backorder belongs to user', async () => {
      const result = await controller.cancel(backorderId, {} as never, reqWithUser as never);

      expect(backordersRepository.findByIdOrThrow).toHaveBeenCalledWith(backorderId);
      expect(backorderService.cancel).toHaveBeenCalledWith(backorderId);
      expect(result.status).toBe(BackorderStatus.CANCELLED);
    });

    it('throws BadRequestException when user not authenticated', async () => {
      await expect(controller.cancel(backorderId, {} as never, {} as never)).rejects.toThrow(BadRequestException);
      expect(backorderService.cancel).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when backorder belongs to another user and caller is not admin', async () => {
      backordersRepository.findByIdOrThrow.mockResolvedValue(backorderOwnedByOther as never);

      await expect(controller.cancel(backorderId, {} as never, reqWithUser as never)).rejects.toThrow(
        ForbiddenException,
      );
      expect(backorderService.cancel).not.toHaveBeenCalled();
    });

    it('allows admin to cancel another user backorder', async () => {
      backordersRepository.findByIdOrThrow.mockResolvedValue(backorderOwnedByOther as never);
      backorderService.cancel.mockResolvedValue({
        ...backorderOwnedByOther,
        status: BackorderStatus.CANCELLED,
      } as never);

      const result = await controller.cancel(backorderId, {} as never, reqWithAdmin as never);

      expect(backorderService.cancel).toHaveBeenCalledWith(backorderId);
      expect(result.status).toBe(BackorderStatus.CANCELLED);
    });
  });
});
