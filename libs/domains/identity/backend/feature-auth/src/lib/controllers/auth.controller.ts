import { Public } from '@forepath/identity/backend';
import { BadRequestException, Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';

import { ChangePasswordDto } from '../dto/auth/change-password.dto';
import { ConfirmEmailDto } from '../dto/auth/confirm-email.dto';
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

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password);
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

  @UseGuards(UsersAuthGuard)
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
