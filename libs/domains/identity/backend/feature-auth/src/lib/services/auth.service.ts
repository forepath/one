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

import { DUMMY_PAT_BCRYPT_HASH, PAT_TOKEN_PREFIX } from '../constants/pat.constants';
import { RevokedUserTokensRepository } from '../repositories/revoked-user-tokens.repository';
import { UsersRepository } from '../repositories/users.repository';

import { PersonalAccessTokenService } from './personal-access-token.service';
import { UsersService } from './users.service';

export interface LogoutOptions {
  jti?: string;
  tokenExpiresAt?: Date;
  invalidateAllSessions?: boolean;
}

const JWT_EXPIRES_IN = '7d';
const PASSWORD_RESET_TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

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

  async login(email: string, password: string): Promise<LoginResponse> {
    // PATs must use POST /auth/token — never accept them on interactive login.
    if (password.startsWith(PAT_TOKEN_PREFIX)) {
      await this.usersService.validatePassword(password, DUMMY_PAT_BCRYPT_HASH);
      throw new UnauthorizedException('Invalid email or password');
    }

    const user = await this.usersRepository.findByEmail(email);

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.emailConfirmedAt) {
      throw new UnauthorizedException('Email not confirmed. Please confirm your email before logging in.');
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

    const accessToken = this.generateToken(user, { amr: 'pwd' });

    return {
      access_token: accessToken,
      user: { id: user.id, email: user.email, role: user.role },
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

    const user = await this.usersRepository.findByIdOrThrow(userId);

    if (!user.passwordHash) {
      throw new BadRequestException('This account uses external authentication. Cannot change password here.');
    }

    const valid = await this.usersService.validatePassword(currentPassword, user.passwordHash);

    if (!valid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

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
