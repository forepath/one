import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { PublicWithdrawalService } from '../services/public-withdrawal.service';

import { PublicWithdrawalController } from './public-withdrawal.controller';

describe('PublicWithdrawalController', () => {
  let controller: PublicWithdrawalController;
  const publicWithdrawalService = {
    getAddressee: jest.fn(),
    requestWithdrawal: jest.fn(),
    verifyWithdrawalCode: jest.fn(),
    confirmWithdrawal: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [PublicWithdrawalController],
      providers: [{ provide: PublicWithdrawalService, useValue: publicWithdrawalService }],
    }).compile();

    controller = moduleRef.get(PublicWithdrawalController);
  });

  it('returns addressee', () => {
    publicWithdrawalService.getAddressee.mockReturnValue({
      name: 'Acme GmbH',
      lines: ['Street 1', '10115 Berlin'],
    });

    expect(controller.getAddressee()).toEqual({
      name: 'Acme GmbH',
      lines: ['Street 1', '10115 Berlin'],
    });
  });

  it('maps addressee failures to service unavailable', () => {
    publicWithdrawalService.getAddressee.mockImplementation(() => {
      throw new ServiceUnavailableException('unavailable');
    });

    expect(() => controller.getAddressee()).toThrow(ServiceUnavailableException);
  });

  it('delegates request, verify, and confirm', async () => {
    publicWithdrawalService.requestWithdrawal.mockResolvedValue({ requestId: 'req-1' });
    publicWithdrawalService.verifyWithdrawalCode.mockResolvedValue({ resumeStep: 'acknowledge' });
    publicWithdrawalService.confirmWithdrawal.mockResolvedValue({ message: 'ok' });

    await expect(
      controller.requestWithdrawal({
        subscriptionNumber: 'SUB-000001',
        customerName: 'Jane Doe',
        email: 'billing@example.com',
        orderedOn: '2024-01-10',
      }),
    ).resolves.toEqual({ requestId: 'req-1' });
    await expect(controller.verifyCode({ requestId: 'req-1', code: 'ABC123' })).resolves.toEqual({
      resumeStep: 'acknowledge',
    });
    await expect(controller.confirmWithdrawal({ requestId: 'req-1', acknowledgeWithdrawal: true })).resolves.toEqual({
      message: 'ok',
    });
  });
});
