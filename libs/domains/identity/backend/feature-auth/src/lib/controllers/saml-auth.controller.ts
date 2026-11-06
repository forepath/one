import { Public } from '@forepath/identity/backend';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { RequireInteractiveSession } from '../decorators/require-scopes.decorator';
import { LogoutDto } from '../dto/auth/logout.dto';
import { SamlTokenExchangeDto } from '../dto/auth/saml-token-exchange.dto';
import { type AuthenticatedUsersRequestUser, UsersAuthGuard } from '../guards/users-auth.guard';
import { SamlAuthService } from '../saml/saml-auth.service';
import { AuthService } from '../services/auth.service';

interface RequestWithUser extends Request {
  user?: AuthenticatedUsersRequestUser;
}

const SAML_THROTTLE = { default: { limit: 20, ttl: 60_000 } };

/**
 * SAML 2.0 sign-in endpoints (`AUTHENTICATION_METHOD=saml`). See {@link SamlAuthService} for the flow.
 * Password login, registration and 2FA endpoints are not exposed in this mode.
 */
@Controller('auth')
export class SamlAuthController {
  constructor(
    private readonly samlAuthService: SamlAuthService,
    private readonly authService: AuthService,
  ) {}

  @Public()
  @Throttle(SAML_THROTTLE)
  @Get('saml/login')
  async login(
    @Query('code_challenge') codeChallenge: string | undefined,
    @Query('redirect') redirect: string | undefined,
    @Query('tenant') tenant: string | undefined,
    @Headers('x-tenant') tenantHeader: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    let location: string;

    try {
      location = await this.samlAuthService.createLoginRedirect(codeChallenge, redirect, tenant ?? tenantHeader);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error && /tenant/i.test(error.message)
          ? 'Invalid or unknown tenant.'
          : 'A valid PKCE code_challenge (S256) is required.',
      );
    }

    res.setHeader('Cache-Control', 'no-store');
    res.redirect(HttpStatus.FOUND, location);
  }

  /** Assertion Consumer Service (HTTP-POST binding). Always redirects to the console callback. */
  @Public()
  @Throttle(SAML_THROTTLE)
  @Post('saml/acs')
  async assertionConsumerService(@Body() body: Record<string, unknown>, @Res() res: Response): Promise<void> {
    const location = await this.samlAuthService.handleAssertionConsumerService(body);

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.redirect(HttpStatus.SEE_OTHER, location);
  }

  @Public()
  @Throttle(SAML_THROTTLE)
  @Post('saml/token')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async token(@Body() dto: SamlTokenExchangeDto): Promise<{ access_token: string }> {
    return this.samlAuthService.exchangeCode(dto.code, dto.codeVerifier);
  }

  @Public()
  @Get('saml/metadata')
  @Header('Content-Type', 'application/samlmetadata+xml; charset=utf-8')
  metadata(): string {
    return this.samlAuthService.getServiceProviderMetadata();
  }

  /** Revokes the current console session (same contract as users-mode `POST /auth/logout`). */
  @RequireInteractiveSession()
  @UseGuards(UsersAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() dto: LogoutDto, @Req() req: RequestWithUser) {
    const user = req.user;

    if (!user?.id) {
      throw new BadRequestException('User not authenticated');
    }

    await this.authService.logout(user.id, {
      invalidateAllSessions: dto.invalidateAllSessions === true,
      jti: user.jti,
      tokenExpiresAt: user.exp ? new Date(user.exp * 1000) : undefined,
    });
  }
}
