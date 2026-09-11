import { randomUUID } from 'node:crypto';

import {
  UserEntity,
  UserRole,
  createConfirmationCode,
  validateConfirmationCode,
  IDENTITY_EMAIL_DISPATCHER,
  type IIdentityEmailDispatcher,
} from '@forepath/identity/backend';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

import {
  EMAIL_NOT_CONFIRMED_CODE,
  EMAIL_NOT_CONFIRMED_MESSAGE,
  LOGIN_2FA_INVALID_CODE,
  LOGIN_2FA_INVALID_MESSAGE,
  LOGIN_2FA_REQUIRED_CODE,
  LOGIN_2FA_REQUIRED_MESSAGE,
  isForceLogin2faEnabled,
  type Login2faMethod,
} from '../constants/auth-error.constants';
import { DUMMY_PAT_BCRYPT_HASH, PAT_TOKEN_PREFIX } from '../constants/pat.constants';
import { TwoFactorStatusDto } from '../dto/auth/two-factor-status.dto';
import { RevokedUserTokensRepository } from '../repositories/revoked-user-tokens.repository';
import { UsersRepository } from '../repositories/users.repository';
import { buildTotpOtpauthUrl, createTotpSecret, verifyTotpCode } from '../utils/totp.utils';

import { PersonalAccessTokenService } from './personal-access-token.service';
import { UsersService } from './users.service';

export interface LogoutOptions {
  jti?: string;
  tokenExpiresAt?: Date;
  invalidateAllSessions?: boolean;
}

const JWT_EXPIRES_IN = '7d';
const PASSWORD_RESET_TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour
const LOGIN_2FA_EMAIL_TOKEN_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

export interface LoginResponse {
  access_token: string;
  user: { id: string; email: string; role: UserRole };
  scopes?: string[];
}

export interface GenerateTokenOptions {
  amr: 'pwd' | 'pat';
  scopes?: string[];
  patId?: string;
}

export interface ChangePasswordResponse {
  message: string;
  access_token: string;
}

export interface RegisterResponse {
  user: { id: string; email: string; role: UserRole };
  message: string;
  /** True when the account is already confirmed (e.g. first user bootstrap). */
  emailConfirmed: boolean;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly revokedUserTokensRepository: RevokedUserTokensRepository,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly personalAccessTokenService: PersonalAccessTokenService,
    @Optional()
    @Inject(IDENTITY_EMAIL_DISPATCHER)
    private readonly emailDispatcher: IIdentityEmailDispatcher | null,
  ) {}

  async login(email: string, password: string, code?: string): Promise<LoginResponse> {
    // PATs must use POST /auth/token — never accept them on interactive login.
    if (password.startsWith(PAT_TOKEN_PREFIX)) {
      await this.usersService.validatePassword(password, DUMMY_PAT_BCRYPT_HASH);
      throw new UnauthorizedException('Invalid email or password');
    }

    const user = await this.usersRepository.findByEmail(email);

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.lockedAt) {
      throw new UnauthorizedException('This account is locked. Please contact an administrator.');
    }

    if (!user.passwordHash) {
      throw new UnauthorizedException('This account uses external authentication (Keycloak).');
    }

    const valid = await this.usersService.validatePassword(password, user.passwordHash);

    if (!valid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.emailConfirmedAt) {
      throw new UnauthorizedException({
        message: EMAIL_NOT_CONFIRMED_MESSAGE,
        code: EMAIL_NOT_CONFIRMED_CODE,
      });
    }

    await this.enforceLogin2fa(user, code);

    const accessToken = this.generateToken(user, { amr: 'pwd' });

    return {
      access_token: accessToken,
      user: { id: user.id, email: user.email, role: user.role },
    };
  }

  async getTwoFactorStatus(userId: string): Promise<TwoFactorStatusDto> {
    const user = await this.usersRepository.findByIdOrThrow(userId);
    const totpEnabled = Boolean(user.totpEnabledAt && user.totpSecret);
    const emailEnabled = Boolean(user.email2faEnabledAt);
    const forceEnabled = isForceLogin2faEnabled();
    let method: Login2faMethod | null = null;

    if (totpEnabled) {
      method = 'totp';
    } else if (forceEnabled || emailEnabled) {
      method = 'email';
    }

    return {
      forceEnabled,
      emailEnabled,
      totpEnabled,
      method,
    };
  }

  async beginOrConfirmEmail2fa(userId: string, code?: string): Promise<{ message: string; pending?: boolean }> {
    let user = await this.usersRepository.findByIdOrThrow(userId);

    if (user.email2faEnabledAt) {
      return { message: 'Email two-factor authentication is already enabled.' };
    }

    if (!code) {
      await this.issueLogin2faEmailCode(user);

      return {
        message: 'A verification code was sent to your email. Submit it to enable email two-factor authentication.',
        pending: true,
      };
    }

    user = await this.usersRepository.findByIdOrThrow(userId);
    await this.verifyLogin2faEmailCode(user, code);
    await this.usersRepository.update(user.id, {
      email2faEnabledAt: new Date(),
      login2faEmailToken: null,
      login2faEmailTokenExpiresAt: null,
    });

    return { message: 'Email two-factor authentication enabled.' };
  }

  async disableEmail2fa(userId: string, currentPassword: string): Promise<{ message: string }> {
    const user = await this.usersRepository.findByIdOrThrow(userId);

    if (isForceLogin2faEnabled()) {
      throw new BadRequestException(
        'Email two-factor authentication is required by our organization and cannot be disabled.',
      );
    }

    await this.assertCurrentPassword(user, currentPassword);

    await this.usersRepository.update(user.id, {
      email2faEnabledAt: null,
      login2faEmailToken: null,
      login2faEmailTokenExpiresAt: null,
    });

    return { message: 'Email two-factor authentication disabled.' };
  }

  async setupTotp(userId: string, currentPassword: string): Promise<{ secret: string; otpauthUrl: string }> {
    const user = await this.usersRepository.findByIdOrThrow(userId);

    await this.assertCurrentPassword(user, currentPassword);

    if (user.totpEnabledAt) {
      throw new BadRequestException(
        'Authenticator two-factor authentication is already enabled. Disable it before setting up a new authenticator.',
      );
    }

    const secret = createTotpSecret();
    const issuer = process.env.PRODUCT_NAME?.trim() || 'Forepath';

    await this.usersRepository.update(user.id, {
      totpSecret: secret,
      totpEnabledAt: null,
    });

    return {
      secret,
      otpauthUrl: buildTotpOtpauthUrl(secret, user.email, issuer),
    };
  }

  async confirmTotp(userId: string, code: string): Promise<{ message: string; access_token: string }> {
    const user = await this.usersRepository.findByIdOrThrow(userId);

    if (!user.totpSecret) {
      throw new BadRequestException('Authenticator setup has not been started.');
    }

    if (user.totpEnabledAt) {
      throw new BadRequestException('Authenticator two-factor authentication is already enabled.');
    }

    const valid = await verifyTotpCode(code, user.totpSecret);

    if (!valid) {
      throw new BadRequestException('Invalid authenticator code');
    }

    await this.usersRepository.update(user.id, { totpEnabledAt: new Date() });
    await this.invalidateAllSessions(user.id);
    const updatedUser = await this.usersRepository.findByIdOrThrow(userId);

    return {
      message: 'Authenticator two-factor authentication enabled.',
      access_token: this.generateToken(updatedUser, { amr: 'pwd' }),
    };
  }

  async disableTotp(userId: string, code: string): Promise<{ message: string; access_token: string }> {
    const user = await this.usersRepository.findByIdOrThrow(userId);

    if (!user.totpEnabledAt || !user.totpSecret) {
      throw new BadRequestException('Authenticator two-factor authentication is not enabled.');
    }

    const valid = await verifyTotpCode(code, user.totpSecret);

    if (!valid) {
      throw new BadRequestException('Invalid authenticator code');
    }

    await this.clearTotpFields(user.id);
    await this.invalidateAllSessions(user.id);
    const updatedUser = await this.usersRepository.findByIdOrThrow(userId);

    return {
      message: 'Authenticator two-factor authentication disabled.',
      access_token: this.generateToken(updatedUser, { amr: 'pwd' }),
    };
  }

  async exchangePat(token: string): Promise<LoginResponse> {
    const verified = await this.personalAccessTokenService.verifyToken(token);
    const accessToken = this.generateToken(verified.user, {
      amr: 'pat',
      scopes: verified.scopes,
      patId: verified.patId,
    });

    return {
      access_token: accessToken,
      user: { id: verified.user.id, email: verified.user.email, role: verified.user.role },
      scopes: verified.scopes,
    };
  }

  async register(email: string, password: string): Promise<RegisterResponse> {
    if (process.env.DISABLE_SIGNUP === 'true') {
      throw new ServiceUnavailableException('Signup is disabled');
    }

    const count = await this.usersRepository.countByTenant();
    const isFirstUser = count === 0;
    const created = await this.usersService.create(
      { email, password, role: isFirstUser ? UserRole.ADMIN : UserRole.USER },
      isFirstUser,
    );
    const emailConfirmed = Boolean(created.emailConfirmedAt);

    if (emailConfirmed) {
      return {
        user: { id: created.id, email: created.email, role: created.role },
        message: 'Account created successfully. You can log in immediately.',
        emailConfirmed: true,
      };
    }

    return {
      user: { id: created.id, email: created.email, role: created.role },
      message:
        'Account created. Please confirm your email before logging in. Check your inbox for the confirmation code.',
      emailConfirmed: false,
    };
  }

  async confirmEmail(email: string, code: string): Promise<{ message: string }> {
    const user = await this.usersRepository.findByEmail(email);

    if (!user?.emailConfirmationToken) {
      throw new BadRequestException('Invalid or expired confirmation code');
    }

    const valid = await validateConfirmationCode(code, user.emailConfirmationToken);

    if (!valid) {
      throw new BadRequestException('Invalid or expired confirmation code');
    }

    await this.usersRepository.update(user.id, {
      emailConfirmedAt: new Date(),
      emailConfirmationToken: undefined,
    });

    return { message: 'Email confirmed successfully. You can now log in.' };
  }

  async requestPasswordReset(email: string): Promise<{ message: string }> {
    const user = await this.usersRepository.findByEmail(email);

    if (!user || !user.passwordHash) {
      return {
        message: 'If an account exists with this email, you will receive a password reset code.',
      };
    }

    const { code, hash } = createConfirmationCode();
    const codeHash = await hash;
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TOKEN_EXPIRY_MS);

    await this.usersRepository.update(user.id, {
      passwordResetToken: codeHash,
      passwordResetTokenExpiresAt: expiresAt,
    });

    try {
      await this.emailDispatcher?.publishEmail({
        eventType: 'user.password_reset_requested',
        to: user.email,
        templateKey: 'password-reset',
        templateContext: { code },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'email enqueue failed';

      this.logger.error(`Failed to enqueue password reset email: ${message}`);
    }

    return {
      message: 'If an account exists with this email, you will receive a password reset code.',
    };
  }

  async resetPassword(email: string, code: string, newPassword: string): Promise<{ message: string }> {
    const user = await this.usersRepository.findByEmail(email);

    if (!user?.passwordResetToken) {
      throw new BadRequestException('Invalid or expired reset code');
    }

    if (!user.passwordResetTokenExpiresAt || user.passwordResetTokenExpiresAt < new Date()) {
      throw new BadRequestException('Reset code has expired');
    }

    const valid = await validateConfirmationCode(code, user.passwordResetToken);

    if (!valid) {
      throw new BadRequestException('Invalid or expired reset code');
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    await this.usersRepository.update(user.id, {
      passwordHash,
      passwordResetToken: undefined,
      passwordResetTokenExpiresAt: undefined,
    });
    await this.invalidateAllSessions(user.id);

    return { message: 'Password reset successfully. You can now log in with your new password.' };
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    newPasswordConfirmation: string,
  ): Promise<ChangePasswordResponse> {
    if (newPassword !== newPasswordConfirmation) {
      throw new BadRequestException('New password and confirmation do not match');
    }

    if (newPassword === currentPassword) {
      throw new BadRequestException('New password must be different from the current password');
    }

    const user = await this.usersRepository.findByIdOrThrow(userId);

    await this.assertCurrentPassword(user, currentPassword);

    const passwordHash = await bcrypt.hash(newPassword, 12);

    await this.usersRepository.update(userId, { passwordHash });
    await this.invalidateAllSessions(userId);

    const updatedUser = await this.usersRepository.findByIdOrThrow(userId);

    return {
      message: 'Password changed successfully.',
      access_token: this.generateToken(updatedUser, { amr: 'pwd' }),
    };
  }

  async logout(userId: string, options: LogoutOptions = {}): Promise<void> {
    if (options.invalidateAllSessions) {
      await this.invalidateAllSessions(userId);

      return;
    }

    if (options.jti && options.tokenExpiresAt) {
      await this.revokedUserTokensRepository.revoke(options.jti, userId, options.tokenExpiresAt);
    }
  }

  async invalidateAllSessions(userId: string): Promise<number> {
    return this.usersRepository.incrementTokenVersion(userId);
  }

  private async assertCurrentPassword(user: UserEntity, currentPassword: string): Promise<void> {
    if (!user.passwordHash) {
      throw new BadRequestException('This account uses external authentication. Password verification is unavailable.');
    }

    const valid = await this.usersService.validatePassword(currentPassword, user.passwordHash);

    if (!valid) {
      throw new UnauthorizedException('Current password is incorrect');
    }
  }

  private async enforceLogin2fa(user: UserEntity, code?: string): Promise<void> {
    const totpEnabled = Boolean(user.totpEnabledAt && user.totpSecret);
    const forceEnabled = isForceLogin2faEnabled();
    const emailEnabled = Boolean(user.email2faEnabledAt);
    const emailRequired = forceEnabled || emailEnabled;

    if (!totpEnabled && !emailRequired) {
      return;
    }

    if (totpEnabled) {
      if (!code) {
        this.throwLogin2faRequired('totp');
      }

      const valid = await verifyTotpCode(code, user.totpSecret as string);

      if (!valid) {
        this.throwLogin2faInvalid('totp');
      }

      return;
    }

    if (!code) {
      await this.issueLogin2faEmailCode(user);
      this.throwLogin2faRequired('email');
    }

    await this.verifyLogin2faEmailCode(user, code);
    await this.usersRepository.update(user.id, {
      login2faEmailToken: null,
      login2faEmailTokenExpiresAt: null,
    });
  }

  private throwLogin2faRequired(method: Login2faMethod): never {
    throw new UnauthorizedException({
      message: LOGIN_2FA_REQUIRED_MESSAGE,
      code: LOGIN_2FA_REQUIRED_CODE,
      method,
    });
  }

  private throwLogin2faInvalid(method: Login2faMethod, message: string = LOGIN_2FA_INVALID_MESSAGE): never {
    throw new UnauthorizedException({
      message,
      code: LOGIN_2FA_INVALID_CODE,
      method,
    });
  }

  private async issueLogin2faEmailCode(user: UserEntity): Promise<void> {
    if (!this.emailDispatcher) {
      throw new ServiceUnavailableException(
        'Two-factor email verification is temporarily unavailable. Please try again later.',
      );
    }

    const { code, hash } = createConfirmationCode();
    const codeHash = await hash;
    const expiresAt = new Date(Date.now() + LOGIN_2FA_EMAIL_TOKEN_EXPIRY_MS);

    await this.usersRepository.update(user.id, {
      login2faEmailToken: codeHash,
      login2faEmailTokenExpiresAt: expiresAt,
    });

    // Keep in-memory copy for subsequent verify in the same request path when needed.
    user.login2faEmailToken = codeHash;
    user.login2faEmailTokenExpiresAt = expiresAt;

    try {
      await this.emailDispatcher.publishEmail({
        eventType: 'user.login_2fa_requested',
        to: user.email,
        templateKey: 'login-2fa',
        templateContext: { code },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'email enqueue failed';

      this.logger.error(`Failed to enqueue login 2FA email: ${message}`);

      await this.usersRepository.update(user.id, {
        login2faEmailToken: null,
        login2faEmailTokenExpiresAt: null,
      });
      user.login2faEmailToken = null;
      user.login2faEmailTokenExpiresAt = null;

      throw new ServiceUnavailableException(
        'Two-factor email verification is temporarily unavailable. Please try again later.',
      );
    }
  }

  private async verifyLogin2faEmailCode(user: UserEntity, code: string): Promise<void> {
    if (!user.login2faEmailToken) {
      this.throwLogin2faInvalid('email');
    }

    if (!user.login2faEmailTokenExpiresAt || user.login2faEmailTokenExpiresAt < new Date()) {
      this.throwLogin2faInvalid('email', 'Verification code has expired. Sign in again to receive a new code.');
    }

    const valid = await validateConfirmationCode(code.toUpperCase(), user.login2faEmailToken);

    if (!valid) {
      this.throwLogin2faInvalid('email');
    }
  }

  private async clearTotpFields(userId: string): Promise<void> {
    await this.usersRepository.update(userId, {
      totpSecret: null,
      totpEnabledAt: null,
    });
  }

  private generateToken(user: UserEntity, options: GenerateTokenOptions): string {
    return this.jwtService.sign(
      {
        sub: user.id,
        email: user.email,
        roles: [user.role],
        amr: [options.amr],
        ...(options.amr === 'pat' && options.scopes ? { scopes: options.scopes, patId: options.patId } : {}),
        tv: user.tokenVersion ?? 0,
      },
      { expiresIn: JWT_EXPIRES_IN, jwtid: randomUUID() },
    );
  }
}
