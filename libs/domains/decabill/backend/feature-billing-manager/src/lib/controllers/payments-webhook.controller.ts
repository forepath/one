import { Public } from '@forepath/identity/backend';
import { BadRequestException, Controller, Headers, Logger, Post, Req } from '@nestjs/common';
import type { Request } from 'express';

import { PaymentOrchestrationService } from '../services/payment-orchestration.service';

interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

@Controller('webhooks/payments')
export class PaymentsWebhookController {
  private readonly logger = new Logger(PaymentsWebhookController.name);

  constructor(private readonly paymentOrchestrationService: PaymentOrchestrationService) {}

  @Public()
  @Post('stripe')
  async handleStripe(
    @Req() req: RawBodyRequest,
    @Headers('stripe-signature') signature?: string,
  ): Promise<{ received: boolean }> {
    const rawBody =
      req.rawBody ?? (typeof req.body === 'string' ? Buffer.from(req.body) : Buffer.from(JSON.stringify(req.body)));

    try {
      await this.paymentOrchestrationService.handleWebhook('stripe', rawBody, signature);
    } catch (error) {
      this.logger.warn(`Stripe webhook failed: ${(error as Error).message}`);

      throw new BadRequestException('Webhook processing failed');
    }

    return { received: true };
  }
}
