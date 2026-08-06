import type { AddonImplementationType } from '../entities/addon.entity';
import type { BillingIntervalType } from '../entities/service-plan.entity';
import type { CloudInitConfigOrderFieldDto } from './cloud-init-config-response.dto';
import type { AttachedMeterResponseDto } from './meter-response.dto';

export class AddonResponseDto {
  id!: string;
  key!: string;
  name!: string;
  description?: string | null;
  implementationType!: AddonImplementationType;
  moduleKey?: string | null;
  scriptTemplate?: string | null;
  deprovisionScriptTemplate?: string | null;
  configSchema!: Record<string, unknown>;
  /** Decrypted defaults; only included on admin GET by id / create / update. */
  defaultValues?: Record<string, string>;
  compatibleProviders!: string[];
  basePrice?: string | null;
  priceIntervalType?: BillingIntervalType | null;
  priceIntervalValue?: number | null;
  meters!: AttachedMeterResponseDto[];
  isActive!: boolean;
  createdAt!: Date;
  updatedAt!: Date;
}

/** Customer-facing addon option for a plan (order form). */
export class PlanAddonOptionDto {
  id!: string;
  key!: string;
  name!: string;
  description?: string | null;
  implementationType!: AddonImplementationType;
  basePrice?: string | null;
  priceIntervalType?: BillingIntervalType | null;
  priceIntervalValue?: number | null;
  /** Period-normalized price for the plan's billing interval. */
  periodPrice!: number;
  /** Customer-visible config fields (no secret values). */
  orderFields!: CloudInitConfigOrderFieldDto[];
  /** Attached usage meters (read-only on customer order). */
  meters!: AttachedMeterResponseDto[];
}
