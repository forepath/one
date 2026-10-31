import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { FLEET_ROLES, type FleetRole } from '../constants/fleet.constants';

const NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const VOLUME = /^[a-z0-9_.-]{1,63}$/;
/** `decabill:<subscription>:<item>` or another `<source>:<id>` reference. */
const REFERENCE = /^[a-z][a-z0-9-]{0,31}:[A-Za-z0-9:._-]{1,200}$/;

export class CreateClusterDto {
  @Matches(NAME)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  description?: string;

  /** HTTPS URL of the control plane (`https://lw.example.com`), without `/api`. */
  @IsString()
  @MaxLength(512)
  endpoint!: string;

  /** PAT of the cluster's fleet service user (see the docs for roles and scopes). */
  @IsString()
  @MinLength(16)
  @MaxLength(4096)
  credential!: string;

  @IsOptional()
  @IsString()
  @MaxLength(65_536)
  caCertificate?: string;

  /** Test the connection before saving (default true). */
  @IsOptional()
  @IsBoolean()
  test?: boolean;
}

export class UpdateClusterDto {
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  description?: string;

  /** A changed endpoint (or CA) requires `credential` in the same request: the stored one never goes elsewhere. */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  endpoint?: string;

  /** Rotation of the service credential. */
  @IsOptional()
  @IsString()
  @MinLength(16)
  @MaxLength(4096)
  credential?: string;

  /** Empty string removes a custom CA. */
  @IsOptional()
  @IsString()
  @MaxLength(65_536)
  caCertificate?: string;
}

export class TestClusterDto {
  @IsString()
  @MaxLength(512)
  endpoint!: string;

  @IsString()
  @MinLength(16)
  @MaxLength(4096)
  credential!: string;

  @IsOptional()
  @IsString()
  @MaxLength(65_536)
  caCertificate?: string;
}

export class PutGrantDto {
  @IsUUID()
  userId!: string;

  @IsIn(FLEET_ROLES as unknown as string[])
  role!: FleetRole;

  /** Limits the grant to one project of the cluster (empty = cluster-wide). */
  @IsOptional()
  @Matches(NAME)
  project?: string;
}

export class CompareQueryDto {
  /** Comma-separated cluster ids (2 to 8). */
  @IsString()
  @MaxLength(8 * 37)
  clusters!: string;
}

export class RestoreBackupDto {
  @IsUUID()
  backupId!: string;

  @Matches(VOLUME)
  volume!: string;
}

export class RestoreTargetDto {
  @Matches(NAME)
  project!: string;

  @Matches(NAME)
  deployment!: string;
}

export class CreateRestoreOperationDto {
  @IsIn(['cross-cluster-restore', 'clone'])
  kind!: 'cross-cluster-restore' | 'clone';

  @IsUUID()
  sourceClusterId!: string;

  @IsUUID()
  targetClusterId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(16)
  @ValidateNested({ each: true })
  @Type(() => RestoreBackupDto)
  backups!: RestoreBackupDto[];

  @ValidateNested()
  @Type(() => RestoreTargetDto)
  target!: RestoreTargetDto;

  /** Clone: the source deployment copied to the target first. */
  @IsOptional()
  @ValidateNested()
  @Type(() => RestoreTargetDto)
  clone?: RestoreTargetDto;

  @IsOptional()
  @IsIn(['replace', 'merge'])
  mode?: 'replace' | 'merge';

  /** Apply the plans on the target (its approvals still apply); default false = plans wait for review there. */
  @IsOptional()
  @IsBoolean()
  apply?: boolean;
}

export class ListOperationsQueryDto {
  @IsOptional()
  @IsUUID()
  cluster?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class FleetAuditQueryDto {
  @IsOptional()
  @IsUUID()
  cluster?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  action?: string;

  @IsOptional()
  @Matches(/^\d{1,19}$/)
  before?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

export class RegisterCloudClusterDto extends CreateClusterDto {
  /** `decabill:<subscriptionId>:<itemId>` for Decabill-provisioned clusters. */
  @Matches(REFERENCE)
  reference!: string;

  /** Fleet users granted on registration (e.g. the customer's account), optional. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(16)
  @ValidateNested({ each: true })
  @Type(() => PutGrantDto)
  grants?: PutGrantDto[];
}

export class CloudTeardownDto {
  /** End of the read-only grace (Decabill's `teardownNotBefore`). */
  @IsDateString()
  readOnlyUntil!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;

  /** Trigger the final backup (default true; repeated calls never start a second one). */
  @IsOptional()
  @IsBoolean()
  finalBackup?: boolean;
}

export const CLOUD_REFERENCE_PATTERN = REFERENCE;

/**
 * `POST /clusters/:id/trust` (2026-10-29): establish trust with the cluster. Without a token the connection's own
 * credential is used; `adminToken` is a cluster admin's token for this one call (never stored or logged).
 */
export class EstablishTrustDto {
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  adminToken?: string;
}
