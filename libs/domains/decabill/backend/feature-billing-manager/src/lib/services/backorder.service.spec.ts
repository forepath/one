import { BadRequestException } from '@nestjs/common';

import { BackorderStatus } from '../entities/backorder.entity';
import { BackordersRepository } from '../repositories/backorders.repository';

import { BackorderService } from './backorder.service';

describe('BackorderService cancel', () => {
  const backordersRepository = {
    findByIdOrThrow: jest.fn(),
    update: jest.fn(),
  } as unknown as BackordersRepository;

  const service = new BackorderService(
    backordersRepository,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('cancels pending backorders', async () => {
    backordersRepository.findByIdOrThrow = jest.fn().mockResolvedValue({ id: 'bo-1', status: BackorderStatus.PENDING });
    backordersRepository.update = jest.fn().mockResolvedValue({ id: 'bo-1', status: BackorderStatus.CANCELLED });

    const result = await service.cancel('bo-1');

    expect(result.status).toBe(BackorderStatus.CANCELLED);
  });

  it('rejects cancelling fulfilled backorders', async () => {
    backordersRepository.findByIdOrThrow = jest
      .fn()
      .mockResolvedValue({ id: 'bo-1', status: BackorderStatus.FULFILLED });

    await expect(service.cancel('bo-1')).rejects.toBeInstanceOf(BadRequestException);
  });
});
