import { IsBoolean, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class CreateSubscriptionDto {
  @IsNotEmpty({ message: 'Plan ID is required' })
  @IsString({ message: 'Plan ID must be a string' })
  planId!: string;

  /**
   * Optional configuration merged with plan defaults for provisioning.
   * May include: authenticationMethod, disableSignup, smtp (host, port, user, password, from), keycloak.
   */
  @IsOptional()
  @IsObject({ message: 'Requested config must be an object' })
  requestedConfig?: Record<string, unknown>;

  @IsOptional()
  @IsObject({ message: 'Preferred alternatives must be an object' })
  preferredAlternatives?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean({ message: 'autoBackorder must be a boolean' })
  autoBackorder?: boolean;

  @IsOptional()
  @IsString({ message: 'Promotion code must be a string' })
  promotionCode?: string;

  @IsOptional()
  @IsString({ message: 'Promotion benefit start must be an ISO date string' })
  promotionBenefitStartsAt?: string;
}
