import { Public } from '@forepath/identity/backend';
import { Body, Controller, Header, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { AppTokenRequestDto } from '../dto/auth/identity-app.dto';
import { IdentityAppAuthorizationService } from '../services/identity-app-authorization.service';

/** Stricter than the global limiter: bcrypt compare of the app secret is expensive. */
const AUTH_SECRET_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

/**
 * Public token endpoint for apps (server-to-server; app id + secret authenticate the app).
 * - `authorization_code`: code from the return URL (+ `code_verifier` when PKCE was used) → access + refresh token
 * - `refresh_token`: rotating refresh token → new access + refresh token
 */
@Controller('auth/apps')
export class IdentityAppTokenController {
  constructor(private readonly authorizationService: IdentityAppAuthorizationService) {}

  @Public()
  @Throttle(AUTH_SECRET_THROTTLE)
  @Post('token')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  async token(@Body() dto: AppTokenRequestDto) {
    if (dto.grant_type === 'refresh_token') {
      return this.authorizationService.refresh({
        appId: dto.app_id,
        appSecret: dto.app_secret,
        refreshToken: dto.refresh_token,
      });
    }

    return this.authorizationService.exchangeAuthorizationCode({
      appId: dto.app_id,
      appSecret: dto.app_secret,
      code: dto.code,
      codeVerifier: dto.code_verifier,
    });
  }
}
