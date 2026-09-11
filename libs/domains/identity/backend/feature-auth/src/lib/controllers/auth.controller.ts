import { Public } from '@forepath/identity/backend';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';

import { RequirePasswordSession } from '../decorators/require-scopes.decorator';
import { ChangePasswordDto } from '../dto/auth/change-password.dto';
import { ConfirmEmailDto } from '../dto/auth/confirm-email.dto';
import { ConfirmTotpDto } from '../dto/auth/confirm-totp.dto';
import { CurrentPasswordDto } from '../dto/auth/current-password.dto';
import { DisableTotpDto } from '../dto/auth/disable-totp.dto';
import { EnableEmail2faDto } from '../dto/auth/enable-email-2fa.dto';
import { LoginDto } from '../dto/auth/login.dto';
import { LogoutDto } from '../dto/auth/logout.dto';
import { RegisterDto } from '../dto/auth/register.dto';
import { RequestPasswordResetDto } from '../dto/auth/request-password-reset.dto';
import { ResetPasswordDto } from '../dto/auth/reset-password.dto';
import { UsersAuthGuard, type AuthenticatedUsersRequestUser } from '../guards/users-auth.guard';
import { AuthService } from '../services/auth.service';

interface RequestWithUser extends Request {
  user?: AuthenticatedUsersRequestUser;
}

/** Stricter than the global limiter: bcrypt compare is expensive on these routes. */
const AUTH_SECRET_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle(AUTH_SECRET_THROTTLE)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password, dto.code);
  }

  @Public()
  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto.email, dto.password);
  }

  @Public()
  @Post('confirm-email')
  @HttpCode(HttpStatus.OK)
  async confirmEmail(@Body() dto: ConfirmEmailDto) {
    return this.authService.confirmEmail(dto.email, dto.code);
  }

  @Public()
  @Post('request-password-reset')
  @HttpCode(HttpStatus.OK)
  async requestPasswordReset(@Body() dto: RequestPasswordResetDto) {
    return this.authService.requestPasswordReset(dto.email);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.email, dto.code, dto.newPassword);
  }

  @RequirePasswordSession()
  @UseGuards(UsersAuthGuard)
  @Get('2fa')
  async getTwoFactorStatus(@Req() req: RequestWithUser) {
    const userId = req.user?.id;

    if (!userId) {
      throw new BadRequestException('User not authenticated');
    }

    return this.authService.getTwoFactorStatus(userId);
  }

  @RequirePasswordSession()
  @UseGuards(UsersAuthGuard)
  @Throttle(AUTH_SECRET_THROTTLE)
  @Post('2fa/email/enable')
  @HttpCode(HttpStatus.OK)
  async enableEmail2fa(@Body() dto: EnableEmail2faDto, @Req() req: RequestWithUser) {
    const userId = req.user?.id;

    if (!userId) {
      throw new BadRequestException('User not authenticated');
    }

    return this.authService.beginOrConfirmEmail2fa(userId, dto.code);
  }

  @RequirePasswordSession()
  @UseGuards(UsersAuthGuard)
  @Throttle(AUTH_SECRET_THROTTLE)
  @Delete('2fa/email')
  @HttpCode(HttpStatus.OK)
  async disableEmail2fa(@Body() dto: CurrentPasswordDto, @Req() req: RequestWithUser) {
    const userId = req.user?.id;

    if (!userId) {
      throw new BadRequestException('User not authenticated');
    }

    return this.authService.disableEmail2fa(userId, dto.currentPassword);
  }

  @RequirePasswordSession()
  @UseGuards(UsersAuthGuard)
  @Throttle(AUTH_SECRET_THROTTLE)
  @Post('2fa/totp/setup')
  @HttpCode(HttpStatus.OK)
  async setupTotp(@Body() dto: CurrentPasswordDto, @Req() req: RequestWithUser) {
    const userId = req.user?.id;

    if (!userId) {
      throw new BadRequestException('User not authenticated');
    }

    return this.authService.setupTotp(userId, dto.currentPassword);
  }

  @RequirePasswordSession()
  @UseGuards(UsersAuthGuard)
  @Throttle(AUTH_SECRET_THROTTLE)
  @Post('2fa/totp/confirm')
  @HttpCode(HttpStatus.OK)
  async confirmTotp(@Body() dto: ConfirmTotpDto, @Req() req: RequestWithUser) {
    const userId = req.user?.id;

    if (!userId) {
      throw new BadRequestException('User not authenticated');
    }

    return this.authService.confirmTotp(userId, dto.code);
  }

  @RequirePasswordSession()
  @UseGuards(UsersAuthGuard)
  @Throttle(AUTH_SECRET_THROTTLE)
  @Delete('2fa/totp')
  @HttpCode(HttpStatus.OK)
  async disableTotp(@Body() dto: DisableTotpDto, @Req() req: RequestWithUser) {
    const userId = req.user?.id;

    if (!userId) {
      throw new BadRequestException('User not authenticated');
    }

    return this.authService.disableTotp(userId, dto.code);
  }

  @RequirePasswordSession()
  @UseGuards(UsersAuthGuard)
  @Throttle(AUTH_SECRET_THROTTLE)
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(@Body() dto: ChangePasswordDto, @Req() req: RequestWithUser) {
    const userId = req.user?.id;

    if (!userId) {
      throw new BadRequestException('User not authenticated');
    }

    if (dto.newPassword !== dto.newPasswordConfirmation) {
      throw new BadRequestException('New password and confirmation do not match');
    }

    return this.authService.changePassword(userId, dto.currentPassword, dto.newPassword, dto.newPasswordConfirmation);
  }

  @RequirePasswordSession()
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
