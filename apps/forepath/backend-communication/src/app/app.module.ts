import { CommunicationModule } from '@forepath/forepath/backend';
import { getRateLimitConfig } from '@forepath/identity/backend/util-auth/core';
import { MonitoringModule } from '@forepath/shared/backend/feature-monitoring';
import { Module, UnauthorizedException } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TurnstileModule } from 'nest-cloudflare-turnstile';

@Module({
  imports: [
    ThrottlerModule.forRoot(getRateLimitConfig()),
    TurnstileModule.forRoot({
      secretKey: process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY ?? '',
      tokenResponse: (req) => req.body?.turnstileToken,
      skipIf: process.env.NODE_ENV !== 'production',
      exceptionFactory: (reason) => {
        if (reason === 'missing') {
          return new UnauthorizedException('Captcha verification is required.');
        }

        return new UnauthorizedException('Captcha verification failed.');
      },
    }),
    MonitoringModule,
    CommunicationModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
