export * from './lib/billing.module';
export * from './lib/controllers/availability.controller';
export * from './lib/controllers/backorders.controller';
export * from './lib/controllers/customer-profiles.controller';
export * from './lib/controllers/invoices.controller';
export * from './lib/controllers/pricing.controller';
export * from './lib/controllers/public-service-plan-offerings.controller';
export * from './lib/controllers/service-plans.controller';
export * from './lib/controllers/service-types.controller';
export * from './lib/controllers/subscriptions.controller';
export * from './lib/controllers/usage.controller';
export * from './lib/dto/availability-check.dto';
export * from './lib/dto/availability-response.dto';
export * from './lib/dto/backorder-cancel.dto';
export * from './lib/dto/backorder-response.dto';
export * from './lib/dto/backorder-retry.dto';
export * from './lib/dto/cancel-subscription.dto';
export * from './lib/dto/create-invoice.dto';
export * from './lib/dto/create-service-plan.dto';
export * from './lib/dto/service-plan-ordering-highlight.dto';
export * from './lib/dto/create-service-type.dto';
export * from './lib/dto/create-subscription.dto';
export * from './lib/dto/create-usage-record.dto';
export * from './lib/dto/customer-profile-response.dto';
export * from './lib/dto/customer-profile.dto';
export * from './lib/dto/invoice-response.dto';
export * from './lib/dto/pricing-preview.dto';
export * from './lib/dto/public-service-plan-offering.dto';
export * from './lib/dto/resume-subscription.dto';
export * from './lib/dto/server-info-response.dto';
export * from './lib/dto/service-plan-response.dto';
export * from './lib/dto/service-type-response.dto';
export * from './lib/dto/subscription-response.dto';
export * from './lib/dto/update-service-plan.dto';
export * from './lib/dto/update-service-type.dto';
export * from './lib/dto/usage-summary.dto';
export * from './lib/entities/availability-snapshot.entity';
export * from './lib/entities/backorder.entity';
export * from './lib/entities/customer-profile.entity';
export * from './lib/entities/invoice-ref.entity';
export * from './lib/entities/open-position.entity';
export * from './lib/entities/provider-price-snapshot.entity';
export * from './lib/entities/reserved-hostname.entity';
export * from './lib/entities/service-plan.entity';
export * from './lib/entities/service-type.entity';
export * from './lib/entities/subscription-item.entity';
export * from './lib/entities/subscription.entity';
export * from './lib/entities/usage-record.entity';

// Re-export authentication components from shared identity library with "Billing" prefix for backward compatibility
export {
  UserEntity as BillingUserEntity,
  UserRole as BillingUserRole,
  UsersAuthModule as BillingUsersAuthModule,
  KeycloakUserSyncModule as BillingKeycloakUserSyncModule,
  AuthService,
  UsersService,
  UsersRepository,
  AuthController,
  UsersController,
  UsersAuthGuard,
  UsersRolesGuard,
  KeycloakRolesGuard,
  KeycloakAuthGuard,
  Public,
  UsersRoles,
  KeycloakRoles,
  LoginDto,
  RegisterDto,
  ConfirmEmailDto,
  RequestPasswordResetDto,
  ResetPasswordDto,
  ChangePasswordDto,
  CreateUserDto,
  UpdateUserDto,
  UserResponseDto,
} from '@forepath/identity/backend';

export { EmailService } from '@forepath/shared/backend';

export * from './lib/repositories/availability-snapshots.repository';
export * from './lib/repositories/backorders.repository';
export * from './lib/repositories/customer-profiles.repository';
export * from './lib/repositories/invoice-refs.repository';
export * from './lib/repositories/open-positions.repository';
export * from './lib/repositories/provider-price-snapshots.repository';
export * from './lib/repositories/reserved-hostnames.repository';
export * from './lib/repositories/users-billing-day.repository';
export * from './lib/repositories/service-plans.repository';
export * from './lib/repositories/service-types.repository';
export * from './lib/repositories/subscription-items.repository';
export * from './lib/repositories/subscriptions.repository';
export * from './lib/repositories/usage-records.repository';
export * from './lib/services/availability.service';
export * from './lib/services/backorder.service';
export * from './lib/services/billing-schedule.service';
export * from './lib/services/cancellation-policy.service';
export * from './lib/services/customer-profiles.service';
export * from './lib/services/hetzner-provisioning.service';
export * from './lib/services/invoice-creation.service';
export * from './lib/services/invoice-ninja.service';
export * from './lib/services/pricing.service';
export * from './lib/services/provider-pricing.service';
export * from './lib/services/provisioning.service';
export * from './lib/services/subscription.service';
export * from './lib/services/subscription-item-server.service';
export * from './lib/services/usage.service';
export * from './lib/services/invoice-sync.job-handler';
export * from './lib/services/subscription-billing.job-handler';
export * from './lib/services/subscription-expiration.job-handler';
export * from './lib/services/subscription-renewal-reminder.job-handler';
export * from './lib/services/open-position-invoice.job-handler';
export * from './lib/services/subscription-item-update.job-handler';
export * from './lib/services/backorder-retry.job-handler';
export * from './lib/utils/billing-day.utils';
export * from './lib/utils/config-validation.utils';
export * from './lib/utils/hostname-generator.utils';
export * from './lib/utils/provisioning.utils';
