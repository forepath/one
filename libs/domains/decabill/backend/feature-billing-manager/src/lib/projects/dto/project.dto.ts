import { Type } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, IsString, IsUUID, Length, MaxLength, Min } from 'class-validator';

import { ProjectStatus } from '../entities/project.enums';

export class CreateAdminProjectDto {
  @IsUUID('4')
  userId!: string;

  @IsString()
  @Length(1, 255)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  hourlyRateNet!: number;

  @IsOptional()
  @IsString()
  @Length(3, 10)
  currency?: string;
}

export class UpdateAdminProjectDto {
  @IsOptional()
  @IsUUID('4')
  userId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  hourlyRateNet?: number;

  @IsOptional()
  @IsString()
  @Length(3, 10)
  currency?: string;
}

export class ProjectResponseDto {
  id!: string;
  userId!: string;
  name!: string;
  description?: string | null;
  status!: ProjectStatus;
  hourlyRateNet!: number;
  currency!: string;
  createdAt!: Date;
  updatedAt!: Date;
}

export class ProjectListItemDto extends ProjectResponseDto {
  unbilledMinutes!: number;
  openBillableAmountNet!: number;
}

export class AdminProjectListItemDto extends ProjectListItemDto {
  userEmail?: string;
}

export class PaginatedProjectsResponseDto {
  items!: ProjectListItemDto[];
  total!: number;
  limit!: number;
  offset!: number;
}

export class PaginatedAdminProjectsResponseDto {
  items!: AdminProjectListItemDto[];
  total!: number;
  limit!: number;
  offset!: number;
}

export class ProjectSummaryResponseDto {
  projectId!: string;
  totalTrackedMinutes!: number;
  unbilledMinutes!: number;
  openBillableAmountNet!: number;
  billedAmountNet!: number;
  openTicketCount!: number;
  doneTicketCount!: number;
  milestoneCount!: number;
}

export class BillProjectTimeResponseDto {
  invoiceId!: string;
  invoiceNumber?: string;
  billedMinutes!: number;
  amountNet!: number;
}
