import { NotFoundException } from '@nestjs/common';

import { OpenPositionsRepository } from './open-positions.repository';

describe('OpenPositionsRepository', () => {
  let mockRepository: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };

  beforeEach(() => {
    jest.resetAllMocks();
    mockRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };
  });

  describe('create', () => {
    it('creates and saves an open position', async () => {
      const dto = {
        subscriptionId: 'sub-1',
        userId: 'user-1',
        description: 'Subscription 123',
        billUntil: new Date('2024-02-01'),
        skipIfNoBillableAmount: true,
      };
      const created = { id: 'pos-1', ...dto, createdAt: new Date() };

      mockRepository.create.mockReturnValue(created);
      mockRepository.save.mockResolvedValue(created);

      const repository = new OpenPositionsRepository(mockRepository as never);
      const result = await repository.create(dto);

      expect(mockRepository.create).toHaveBeenCalledWith(dto);
      expect(mockRepository.save).toHaveBeenCalledWith(created);
      expect(result).toEqual(created);
    });
  });

  describe('findUnbilledByUserId', () => {
    it('finds positions with null invoiceRefId for user', async () => {
      const positions = [
        {
          id: 'pos-1',
          userId: 'user-1',
          subscriptionId: 'sub-1',
          invoiceRefId: null,
          createdAt: new Date(),
        },
      ];

      mockRepository.find.mockResolvedValue(positions);

      const repository = new OpenPositionsRepository(mockRepository as never);
      const result = await repository.findUnbilledByUserId('user-1');

      expect(mockRepository.find).toHaveBeenCalledWith({
        where: { userId: 'user-1', invoiceRefId: expect.anything() },
        order: { createdAt: 'ASC' },
      });
      expect(result).toEqual(positions);
    });
  });

  describe('markBilled', () => {
    it('updates position with invoiceRefId', async () => {
      const entity = {
        id: 'pos-1',
        userId: 'user-1',
        invoiceRefId: undefined as string | undefined,
      };

      mockRepository.findOne.mockResolvedValue(entity);
      mockRepository.save.mockImplementation((e) => Promise.resolve({ ...e }));

      const repository = new OpenPositionsRepository(mockRepository as never);
      const result = await repository.markBilled('pos-1', 'ref-1');

      expect(mockRepository.findOne).toHaveBeenCalledWith({ where: { id: 'pos-1' } });
      expect(entity.invoiceRefId).toBe('ref-1');
      expect(mockRepository.save).toHaveBeenCalledWith(entity);
      expect(result.invoiceRefId).toBe('ref-1');
    });

    it('throws when position not found', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      const repository = new OpenPositionsRepository(mockRepository as never);

      await expect(repository.markBilled('pos-missing', 'ref-1')).rejects.toThrow(NotFoundException);
      expect(mockRepository.save).not.toHaveBeenCalled();
    });
  });
});
