import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

import { ExternalImportKind, ExternalImportProviderId } from '../../entities/external-import.enums';
import { TicketStatus } from '../../entities/ticket.enums';

export class CreateExternalImportConfigDto {
  @IsEnum(ExternalImportProviderId)
  provider!: ExternalImportProviderId;

  @IsEnum(ExternalImportKind)
  importKind!: ExternalImportKind;

  @IsUUID('4')
  atlassianConnectionId!: string;

  @IsUUID('4')
  clientId!: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  jiraBoardId?: number | null;

  @IsOptional()
  @IsString()
  jql?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  confluenceSpaceKey?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  confluenceRootPageId?: string | null;

  @IsOptional()
  @IsString()
  cql?: string | null;

  @IsOptional()
  @IsUUID('4')
  agenstraParentTicketId?: string | null;

  @IsOptional()
  @IsUUID('4')
  agenstraParentFolderId?: string | null;

  @IsOptional()
  @IsEnum(TicketStatus)
  importTargetTicketStatus?: TicketStatus | null;
}
