import { Test } from '@nestjs/testing';

import { PaymentProcessorFactory } from '../payment-processors/payment-processor.factory';
import { CustomerProfilesService } from '../services/customer-profiles.service';

import { CustomerProfilesController } from './customer-profiles.controller';

describe('CustomerProfilesController', () => {
  it('returns null when no profile', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CustomerProfilesController],
      providers: [
        {
          provide: CustomerProfilesService,
          useValue: { getByUserId: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
        },
        {
          provide: PaymentProcessorFactory,
          useValue: {
            getProcessor: jest.fn().mockReturnValue({ supportsAutoPayment: () => true }),
          },
        },
      ],
    }).compile();
    const controller = moduleRef.get(CustomerProfilesController);
    const result = await controller.get({ user: { id: 'user-1', roles: ['user'] } } as never);

    expect(result).toBeNull();
  });
});
