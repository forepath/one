import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, Length, MaxLength, Min } from 'class-validator';

export class CreateProjectMilestoneDto {
  @IsString()
  @Length(1, 255)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsDateString()
  targetDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateProjectMilestoneDto {
  @IsOptional()
  @IsString()
  @Length(1, 255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsDateString()
  targetDate?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class ProjectMilestoneResponseDto {
  id!: string;
  projectId!: string;
  name!: string;
  description?: string | null;
  targetDate?: Date | null;
  sortOrder!: number;
  lockedAt?: Date | null;
  progressPercent!: number;
  openTicketCount!: number;
  doneTicketCount!: number;
  createdAt!: Date;
  updatedAt!: Date;
}
