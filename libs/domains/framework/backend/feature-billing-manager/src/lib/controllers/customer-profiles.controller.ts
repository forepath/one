import { BadRequestException, Body, Controller, Get, Post, Req } from '@nestjs/common';

import { CustomerProfileResponseDto } from '../dto/customer-profile-response.dto';
import { CustomerProfileDto } from '../dto/customer-profile.dto';
import { CustomerProfileEntity } from '../entities/customer-profile.entity';
import { CustomerProfilesService } from '../services/customer-profiles.service';
import { getUserFromRequest, type RequestWithUser } from '../utils/billing-access.utils';

@Controller('customer-profile')
export class CustomerProfilesController {
  constructor(private readonly customerProfilesService: CustomerProfilesService) {}

  @Get()
  async get(@Req() req?: RequestWithUser): Promise<CustomerProfileResponseDto | null> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    const profile = await this.customerProfilesService.getByUserId(userInfo.userId);

    return profile ? this.mapToResponse(profile) : null;
  }

  @Post()
  async upsert(@Body() dto: CustomerProfileDto, @Req() req?: RequestWithUser): Promise<CustomerProfileResponseDto> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    const profile = await this.customerProfilesService.upsert(userInfo.userId, dto);

    return this.mapToResponse(profile);
  }

  private mapToResponse(row: CustomerProfileEntity): CustomerProfileResponseDto {
    return {
      id: row.id,
      userId: row.userId,
      firstName: row.firstName,
      lastName: row.lastName,
      company: row.company,
      addressLine1: row.addressLine1,
      addressLine2: row.addressLine2,
      postalCode: row.postalCode,
      city: row.city,
      state: row.state,
      country: row.country,
      email: row.email,
      phone: row.phone,
      stripeCustomerId: row.stripeCustomerId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
