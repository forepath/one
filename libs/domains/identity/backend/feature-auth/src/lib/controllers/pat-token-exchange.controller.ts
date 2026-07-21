import { Public } from '@forepath/identity/backend';
import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { ExchangePersonalAccessTokenDto } from '../dto/auth/personal-access-token.dto';
import { AuthService } from '../services/auth.service';

/** Stricter than the global limiter: bcrypt compare is expensive on these routes. */
const AUTH_SECRET_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

/**
 * Public PAT exchange endpoint shared by users-mode and keycloak-mode.
 * Full interactive auth (login/register) stays on AuthController (users-mode only).
 */
@Controller('auth')
export class PatTokenExchangeController {
  constructor(private readonly authService: AuthService) {}

  /** Exchange a personal access token for a machine JWT (`amr: pat`). Token-only; no email. */
  @Public()
  @Throttle(AUTH_SECRET_THROTTLE)
  @Post('token')
  @HttpCode(HttpStatus.OK)
  async exchangeToken(@Body() dto: ExchangePersonalAccessTokenDto) {
    return this.authService.exchangePat(dto.token);
  }
}
