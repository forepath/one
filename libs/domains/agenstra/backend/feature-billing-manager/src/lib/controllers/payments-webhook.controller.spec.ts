import { BadRequestException } from '@nestjs/common';

import { PaymentsWebhookController } from './payments-webhook.controller';

describe('PaymentsWebhookController', () => {
  const paymentOrchestrationService = {
    handleWebhook: jest.fn(),
  };
  const controller = new PaymentsWebhookController(paymentOrchestrationService as never);

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('delegates stripe webhook to orchestration service', async () => {
    const rawBody = Buffer.from('{"id":"evt_1"}');

    paymentOrchestrationService.handleWebhook.mockResolvedValue(undefined);

    const result = await controller.handleStripe({ rawBody } as never, 'sig_header');

    expect(paymentOrchestrationService.handleWebhook).toHaveBeenCalledWith('stripe', rawBody, 'sig_header');
    expect(result).toEqual({ received: true });
  });

  it('throws BadRequestException when webhook processing fails', async () => {
    paymentOrchestrationService.handleWebhook.mockRejectedValue(new Error('invalid'));

    await expect(controller.handleStripe({ rawBody: Buffer.from('{}') } as never, 'sig')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
