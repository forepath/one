import { Public } from '@forepath/identity/backend';
import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';

import { ZodValidationPipe } from '../../utils/zod-validation.pipe';
import { DrRecoveryService, type DrStatusDto } from './dr-recovery.service';

const DR_THROTTLE = { default: { limit: 30, ttl: 60_000 } };
export const DR_SECRET_HEADER = 'x-loadweaver-dr-secret';

const masterKeySchema = z
  .object({
    keyId: z.string().regex(/^[0-9a-f]{16}$/),
    /** base64 of the 32-byte master key from the DR envelope. */
    masterKey: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
  })
  .strict();

/**
 * The restoring agent's side of a whole-cluster disaster recovery (3.20): only while the API runs with
 * `LOADWEAVER_DR_RECOVERY`, authenticated by the secret the agent put there (no user exists to log in with yet:
 * the users are in the database being restored, and the master key isn't unsealed).
 */
@Controller('dr')
export class DrController {
  constructor(private readonly recovery: DrRecoveryService) {}

  @Post('master-key')
  @Public()
  @Throttle(DR_THROTTLE)
  @HttpCode(HttpStatus.OK)
  async masterKey(
    @Body(new ZodValidationPipe(masterKeySchema)) body: z.infer<typeof masterKeySchema>,
    @Headers(DR_SECRET_HEADER) secret?: string,
  ): Promise<DrStatusDto> {
    return await this.recovery.handOverMasterKey(secret, { id: body.keyId, value: body.masterKey });
  }

  @Get('status')
  @Public()
  @Throttle(DR_THROTTLE)
  async status(@Headers(DR_SECRET_HEADER) secret?: string): Promise<DrStatusDto> {
    return await this.recovery.status(secret);
  }
}
