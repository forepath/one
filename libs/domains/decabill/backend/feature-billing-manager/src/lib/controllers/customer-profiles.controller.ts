import { RequireScopes } from '@forepath/identity/backend';
import { BadRequestException, Body, Controller, Get, Post, Req } from '@nestjs/common';

import { CustomerProfileResponseDto } from '../dto/customer-profile-response.dto';
import { CustomerProfileDto } from '../dto/customer-profile.dto';
import { CustomerProfileEntity } from '../entities/customer-profile.entity';
import { PaymentProcessorFactory } from '../payment-processors/payment-processor.factory';
import { CustomerProfilesService } from '../services/customer-profiles.service';
import { getUserFromRequest, type RequestWithUser } from '../utils/billing-access.utils';

@Controller('customer-profile')
@RequireScopes('customer_profile:write')
export class CustomerProfilesController {
  constructor(
    private readonly customerProfilesService: CustomerProfilesService,
    private readonly paymentProcessorFactory: PaymentProcessorFactory,
  ) {}

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

  @Post('vat-id/revalidate')
  async revalidateVatId(@Req() req?: RequestWithUser): Promise<CustomerProfileResponseDto> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    const profile = await this.customerProfilesService.revalidateVatId(userInfo.userId);

    return this.mapToResponse(profile);
  }

  private mapToResponse(row: CustomerProfileEntity): CustomerProfileResponseDto {
    const processorType = process.env.BILLING_DEFAULT_PAYMENT_PROCESSOR ?? 'stripe';
    let supportsAutoPayment = false;

    try {
      supportsAutoPayment = this.paymentProcessorFactory.getProcessor(processorType).supportsAutoPayment();
    } catch {
      supportsAutoPayment = false;
    }

    return {
      id: row.id,
      userId: row.userId,
      firstName: row.firstName,
      lastName: row.lastName,
      company: row.company,
      customerType: row.customerType,
      vatId: row.vatId,
      vatIdValidationStatus: row.vatIdValidationStatus,
      vatIdValidatedAt: row.vatIdValidatedAt,
      vatIdValidationSource: row.vatIdValidationSource,
      addressLine1: row.addressLine1,
      addressLine2: row.addressLine2,
      postalCode: row.postalCode,
      city: row.city,
      state: row.state,
      country: row.country,
      email: row.email,
      phone: row.phone,
      stripeCustomerId: row.stripeCustomerId,
      autoBillingEnabled: row.autoBillingEnabled ?? false,
      hasPaymentMethodOnFile: Boolean(row.defaultPaymentMethodExternalId),
      supportsAutoPayment,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
