import {
  INITIATIVE_ARTIFACT_TYPES,
  INITIATIVE_LIMITS,
  type InitiativeArtifactType,
} from '@forepath/agenstra/shared/util-initiative-method';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class CreateInitiativeArtifactDto {
  @IsIn([...INITIATIVE_ARTIFACT_TYPES])
  type!: InitiativeArtifactType;

  @IsOptional()
  @IsString()
  @MaxLength(INITIATIVE_LIMITS.titleMaxLength)
  title?: string;

  /** Epic the document belongs to (retrospectives, epic documents). */
  @IsOptional()
  @IsUUID('4')
  workItemId?: string;

  /** Initial content; defaults to the document template. */
  @IsOptional()
  @IsString()
  @MaxLength(INITIATIVE_LIMITS.contentMaxLength)
  content?: string;
}

/** Saves a new version (draft until accepted). Conditional on the version the user edited. */
export class UpdateInitiativeArtifactDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsOptional()
  @IsNotEmpty()
  @IsString()
  @MaxLength(INITIATIVE_LIMITS.titleMaxLength)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(INITIATIVE_LIMITS.contentMaxLength)
  content?: string;
}

export class AcceptInitiativeArtifactDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class PublishInitiativeArtifactDto {
  /** Knowledge folder to publish into (root when omitted). */
  @IsOptional()
  @IsUUID('4')
  parentNodeId?: string;
}
