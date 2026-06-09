import { randomUUID } from 'crypto';

import { UsersRepository } from '@forepath/identity/backend';
import { BadRequestException, Inject, Injectable, InternalServerErrorException, Optional } from '@nestjs/common';

import type { AdminBillNowDto, AdminBillNowResponseDto } from '../dto/admin-billing.dto';
import { ADMIN_BILL_NOW_ENQUEUE, type AdminBillNowEnqueuePort } from '../queue/admin-bill-now-enqueue.token';
import { OpenPositionsRepository } from '../repositories/open-positions.repository';

@Injectable()
export class AdminBillNowService {
  constructor(
    private readonly openPositionsRepository: OpenPositionsRepository,
    private readonly usersRepository: UsersRepository,
    @Optional() @Inject(ADMIN_BILL_NOW_ENQUEUE) private readonly enqueuePort?: AdminBillNowEnqueuePort,
  ) {}

  async queueBillNow(adminUserId: string, dto: AdminBillNowDto): Promise<AdminBillNowResponseDto> {
    if (!this.enqueuePort) {
      throw new InternalServerErrorException('Billing queue is not configured');
    }

    if (dto.userId) {
      const user = await this.usersRepository.findById(dto.userId);

      if (!user) {
        throw new BadRequestException('User not found');
      }
    }

    const userIds = await this.resolveTargetUserIds(dto);
    const requestId = randomUUID();

    await this.enqueuePort.enqueueCoordinator({
      requestId,
      adminUserId,
      scope: dto.userId ? 'user' : 'all',
      userId: dto.userId,
    });

    return {
      queued: true,
      requestId,
      userCount: dto.userId ? 1 : userIds.length,
    };
  }

  async resolveTargetUserIds(dto: AdminBillNowDto): Promise<string[]> {
    if (dto.userId) {
      return [dto.userId];
    }

    return this.openPositionsRepository.findDistinctUserIdsWithUnbilled();
  }
}
