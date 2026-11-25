import { Public } from '@forepath/identity/backend';
import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpException,
  Logger,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';

import { PostalLetterService } from '../postal-providers/postal-letter.service';

interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

/** Largest webhook body accepted (provider events are a few KB). */
const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;

/**
 * Postal provider webhooks (`/api/webhooks/postal/{provider}`, e.g. `pingen`). Public: authenticity is the provider's
 * signature, verified with the signing key of the tenant the referenced letter belongs to.
 */
@Controller('webhooks/postal')
export class PostalWebhookController {
  private readonly logger = new Logger(PostalWebhookController.name);

  constructor(private readonly postalLetterService: PostalLetterService) {}

  @Public()
  @Post(':provider')
  @HttpCode(200)
  async handle(@Param('provider') provider: string, @Req() req: RawBodyRequest): Promise<{ received: boolean }> {
    if (!/^[a-z0-9_-]{1,64}$/.test(provider)) {
      throw new NotFoundException('Unknown postal provider');
    }

    const raw = Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.isBuffer(req.body) ? (req.body as Buffer) : null;

    if (!raw || raw.length === 0 || raw.length > MAX_WEBHOOK_BODY_BYTES) {
      throw new BadRequestException('Invalid webhook body');
    }

    try {
      await this.postalLetterService.handleWebhook(provider, raw.toString('utf8'), req.headers);
    } catch (error) {
      // 4xx: rejected (bad signature, unknown provider); 5xx: the provider retries on its schedule.
      const clientError = error instanceof HttpException && error.getStatus() < 500;

      this.logger[clientError ? 'warn' : 'error'](`Postal webhook (${provider}) failed: ${(error as Error).message}`);

      throw error;
    }

    return { received: true };
  }
}
