import {
  BillingIdentityNotificationBridgeModule,
  BillingModule,
  BillingUsersAuthModule,
  createBillingOidcAuthModule,
  createBillingSamlAuthModule,
  DecabillOtelModule,
  type RegisteredContributorNestModule,
} from '@forepath/decabill/backend';
import {
  BullBoardSkippingThrottlerGuard,
  getAuthenticationMethod,
  getIdentityAuthGuards,
  getRateLimitConfig,
} from '@forepath/identity/backend';
import { getTypeOrmOptionsForQueueRole, MonitoringModule } from '@forepath/shared/backend';
import { DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BillingQueueModule } from '../queue/billing-queue.module';
import { typeormConfig } from '../typeorm.config';

const authMethod = getAuthenticationMethod();

@Module({})
export class AppModule {
  static register(extra: RegisteredContributorNestModule[] = []): DynamicModule {
    const billing = BillingModule.withContributors(extra);

    return {
      module: AppModule,
      imports: [
        TypeOrmModule.forRoot(getTypeOrmOptionsForQueueRole(typeormConfig)),
        BillingQueueModule.register(),
        ThrottlerModule.forRoot(getRateLimitConfig()),
        billing,
        BillingIdentityNotificationBridgeModule,
        ...(authMethod === 'oidc' ? [createBillingOidcAuthModule()] : []),
        ...(authMethod === 'saml' ? [createBillingSamlAuthModule()] : []),
        ...(authMethod === 'users' ? [BillingUsersAuthModule] : []),
        DecabillOtelModule,
        MonitoringModule,
      ],
      providers: [
        ...getIdentityAuthGuards(),
        {
          provide: APP_GUARD,
          useClass: BullBoardSkippingThrottlerGuard,
        },
      ],
    };
  }
}
