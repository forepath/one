import {
  createConfirmationCode,
  IDENTITY_NOTIFICATION_PUBLISHER,
  IDENTITY_STATISTICS_SERVICE,
  IIdentityNotificationPublisher,
  IIdentityStatisticsService,
  UserEntity,
  UserRole,
} from '@forepath/identity/backend';
import { EmailService } from '@forepath/shared/backend';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';

import { CreateUserDto } from '../dto/auth/create-user.dto';
import { UpdateUserDto } from '../dto/auth/update-user.dto';
import { UserResponseDto } from '../dto/auth/user-response.dto';
import { UsersRepository } from '../repositories/users.repository';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class UsersService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly emailService: EmailService,
    @Optional()
    @Inject(IDENTITY_STATISTICS_SERVICE)
    private readonly statisticsService: IIdentityStatisticsService | null,
    @Optional()
    @Inject(IDENTITY_NOTIFICATION_PUBLISHER)
    private readonly notificationPublisher: IIdentityNotificationPublisher | null,
  ) {}

  async mapToResponseDto(user: UserEntity): Promise<UserResponseDto> {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      emailConfirmedAt: user.emailConfirmedAt?.toISOString(),
      lockedAt: user.lockedAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }

  async getUsersCount(): Promise<number> {
    return this.usersRepository.countByTenant();
  }

  async findAll(limit = 10, offset = 0): Promise<UserResponseDto[]> {
    const users = await this.usersRepository.findAll(limit, offset);

    return Promise.all(users.map((u) => this.mapToResponseDto(u)));
  }

  async findOne(id: string): Promise<UserResponseDto> {
    const user = await this.usersRepository.findByIdForTenant(id);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.mapToResponseDto(user);
  }

  async create(dto: CreateUserDto, isFirstUser: boolean): Promise<UserResponseDto> {
    const existing = await this.usersRepository.findByEmail(dto.email);

    if (existing) {
      throw new ConflictException('User with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const role = dto.role ?? (isFirstUser ? UserRole.ADMIN : UserRole.USER);
    const user = await this.usersRepository.create({
      email: dto.email,
      passwordHash,
      role,
      emailConfirmedAt: isFirstUser ? new Date() : undefined,
      emailConfirmationToken: undefined,
    });

    this.statisticsService?.recordEntityCreated('user', user.id, { role }, undefined).catch(() => {
      /* fire and forget */
    });
    this.notificationPublisher?.publishUserCreated({
      id: user.id,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt.toISOString(),
    });

    if (!isFirstUser) {
      const { code, hash } = createConfirmationCode();
      const codeHash = await hash;

      await this.usersRepository.update(user.id, { emailConfirmationToken: codeHash });
      await this.emailService.sendConfirmationEmail(user.email, code);
    }

    return this.mapToResponseDto(user);
  }

  async update(id: string, dto: UpdateUserDto): Promise<UserResponseDto> {
    const user = await this.usersRepository.findByIdForTenant(id);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const emailChanged = dto.email && dto.email.toLowerCase() !== user.email;

    if (emailChanged) {
      const existing = await this.usersRepository.findByEmail(dto.email);

      if (existing) {
        throw new ConflictException('User with this email already exists');
      }
    }

    const updateData: Partial<UserEntity> = {};

    if (dto.email !== undefined) updateData.email = dto.email;

    if (dto.role !== undefined) updateData.role = dto.role;

    if (dto.password) {
      updateData.passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    }

    let confirmationCode: string | undefined;

    if (emailChanged && dto.email) {
      const { code, hash } = createConfirmationCode();
      const codeHash = await hash;

      updateData.emailConfirmedAt = null as unknown as Date;
      updateData.emailConfirmationToken = codeHash;
      confirmationCode = code;
    }

    const updated = await this.usersRepository.update(id, updateData);

    if (dto.password) {
      await this.usersRepository.incrementTokenVersion(id);
    }

    this.statisticsService?.recordEntityUpdated('user', id, { role: updated.role }, undefined).catch(() => {
      /* fire and forget */
    });
    this.notificationPublisher?.publishUserUpdated({
      id: updated.id,
      email: updated.email,
      role: updated.role,
      updatedAt: updated.updatedAt.toISOString(),
    });

    if (emailChanged && dto.email && confirmationCode) {
      await this.emailService.sendConfirmationEmail(dto.email, confirmationCode);
    }

    return this.mapToResponseDto(updated);
  }

  async remove(id: string, requestingUserId?: string): Promise<void> {
    const user = await this.usersRepository.findByIdForTenant(id);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    this.statisticsService?.recordEntityDeleted('user', id, requestingUserId).catch(() => {
      /* fire and forget */
    });
    this.notificationPublisher?.publishUserDeleted({
      id: user.id,
      email: user.email,
      role: user.role,
    });
    await this.usersRepository.remove(id);
  }

  async lockUser(targetUserId: string, actingUserId?: string): Promise<UserResponseDto> {
    if (actingUserId && actingUserId === targetUserId) {
      throw new BadRequestException('You cannot lock your own account');
    }

    const user = await this.usersRepository.findByIdForTenant(targetUserId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updated = await this.usersRepository.update(targetUserId, { lockedAt: new Date() });

    return this.mapToResponseDto(updated);
  }

  async unlockUser(targetUserId: string, actingUserId?: string): Promise<UserResponseDto> {
    if (actingUserId && actingUserId === targetUserId) {
      throw new BadRequestException('You cannot unlock your own account');
    }

    const user = await this.usersRepository.findByIdForTenant(targetUserId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updated = await this.usersRepository.update(targetUserId, { lockedAt: null });

    return this.mapToResponseDto(updated);
  }

  async validatePassword(plainPassword: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plainPassword, hash);
  }
}
