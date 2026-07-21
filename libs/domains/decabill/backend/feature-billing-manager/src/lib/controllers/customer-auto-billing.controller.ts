import { RequireScopes } from '@forepath/identity/backend';
import { BadRequestException, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';

import { CustomerProfileResponseDto } from '../dto/customer-profile-response.dto';
import { CustomerProfileEntity } from '../entities/customer-profile.entity';
import { AutoBillingService } from '../services/auto-billing.service';
import { PaymentProcessorFactory } from '../payment-processors/payment-processor.factory';
import { getUserFromRequest, type RequestWithUser } from '../utils/billing-access.utils';

@Controller('customer-profile/auto-billing')
@RequireScopes('customer_profile:write')
export class CustomerAutoBillingController {
  constructor(
    private readonly autoBillingService: AutoBillingService,
    private readonly paymentProcessorFactory: PaymentProcessorFactory,
  ) {}

  @Post('setup')
  async setup(@Req() req?: RequestWithUser): Promise<{ setupUrl: string }> {
    const userId = this.requireUserId(req);

    return await this.autoBillingService.createSetupSessionForUser(userId);
  }

  @Post('enable')
  async enable(@Req() req?: RequestWithUser): Promise<CustomerProfileResponseDto> {
    const userId = this.requireUserId(req);
    const profile = await this.autoBillingService.enableForUser(userId);

    return this.mapToResponse(profile);
  }

  @Post('disable')
  @HttpCode(HttpStatus.OK)
  async disable(@Req() req?: RequestWithUser): Promise<CustomerProfileResponseDto> {
    const userId = this.requireUserId(req);
    const profile = await this.autoBillingService.disableForUser(userId);

    return this.mapToResponse(profile);
  }

  private requireUserId(req?: RequestWithUser): string {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    return userInfo.userId;
  }

  private mapToResponse(row: CustomerProfileEntity): CustomerProfileResponseDto {
    const processorType = this.autoBillingService.resolveDefaultProcessorType();
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
