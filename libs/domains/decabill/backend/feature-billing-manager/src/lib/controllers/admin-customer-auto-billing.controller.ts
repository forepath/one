import { KeycloakRoles, RequireScopes, UserRole, UsersRoles } from '@forepath/identity/backend';
import { Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';

import type { CustomerProfileResponseDto } from '../dto/customer-profile-response.dto';
import { CustomerProfileEntity } from '../entities/customer-profile.entity';
import { AutoBillingService } from '../services/auto-billing.service';
import { CustomerProfilesAdminService } from '../services/customer-profiles-admin.service';
import { PaymentProcessorFactory } from '../payment-processors/payment-processor.factory';

@Controller('admin/billing/customer-profiles/:id/auto-billing')
@KeycloakRoles(UserRole.ADMIN)
@UsersRoles(UserRole.ADMIN)
@RequireScopes('customer_profile:admin')
export class AdminCustomerAutoBillingController {
  constructor(
    private readonly autoBillingService: AutoBillingService,
    private readonly customerProfilesAdminService: CustomerProfilesAdminService,
    private readonly paymentProcessorFactory: PaymentProcessorFactory,
  ) {}

  @Post('setup')
  async setup(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<{ setupUrl: string }> {
    const profile = await this.customerProfilesAdminService.getById(id);

    return await this.autoBillingService.createSetupSessionForUser(profile.userId);
  }

  @Post('enable')
  async enable(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<CustomerProfileResponseDto> {
    const profile = await this.customerProfilesAdminService.getById(id);
    const updated = await this.autoBillingService.enableForUser(profile.userId);

    return this.mapToResponse(updated);
  }

  @Post('disable')
  @HttpCode(HttpStatus.OK)
  async disable(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<CustomerProfileResponseDto> {
    const profile = await this.customerProfilesAdminService.getById(id);
    const updated = await this.autoBillingService.disableForUser(profile.userId);

    return this.mapToResponse(updated);
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
