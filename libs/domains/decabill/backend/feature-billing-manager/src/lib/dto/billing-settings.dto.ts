import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class BillingSettingsScopeQueryDto {
  /** `global`: override for all tenants (global-view tenants only); `tenant`: one tenant. */
  @IsOptional()
  @IsIn(['global', 'tenant'], { message: 'level must be "global" or "tenant"' })
  level?: 'global' | 'tenant';

  /** Tenant to configure (other than the own tenant only with `TENANTS_ALLOW_GLOBAL_VIEWS`). */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  viewTenantId?: string;
}

export class UpsertBillingSettingDto {
  @IsString({ message: 'value must be a string' })
  @MaxLength(65536, { message: 'value must be at most 65536 characters' })
  value!: string;
}
