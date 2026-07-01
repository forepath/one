import { IsDateString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateProjectTimeEntryDto {
  @IsOptional()
  @IsUUID('4')
  ticketId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsDateString()
  startedAt!: string;

  @IsDateString()
  endedAt!: string;
}

export class UpdateProjectTimeEntryDto {
  @IsOptional()
  @IsUUID('4')
  ticketId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsOptional()
  @IsDateString()
  startedAt?: string;

  @IsOptional()
  @IsDateString()
  endedAt?: string;
}

export class ProjectTimeEntryResponseDto {
  id!: string;
  projectId!: string;
  ticketId?: string | null;
  recordedByUserId!: string;
  durationMinutes!: number;
  description?: string | null;
  startedAt!: Date;
  endedAt!: Date;
  /** @deprecated Use startedAt */
  recordedAt!: Date;
  invoiceId?: string | null;
  billedAt?: Date | null;
  createdAt!: Date;
}

export class PaginatedProjectTimeEntriesResponseDto {
  items!: ProjectTimeEntryResponseDto[];
  total!: number;
  limit!: number;
  offset!: number;
}
