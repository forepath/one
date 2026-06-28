import { IsEnum, IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';

import { ProjectTicketPriority, ProjectTicketStatus } from '../entities/project.enums';

export class CreateProjectTicketDto {
  @IsOptional()
  @IsUUID('4')
  parentId?: string;

  @IsOptional()
  @IsUUID('4')
  milestoneId?: string;

  @IsString()
  @Length(1, 500)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100000)
  content?: string;

  @IsOptional()
  @IsEnum(ProjectTicketPriority)
  priority?: ProjectTicketPriority;

  @IsOptional()
  @IsEnum(ProjectTicketStatus)
  status?: ProjectTicketStatus;
}

export class UpdateProjectTicketDto {
  @IsOptional()
  @IsUUID('4')
  parentId?: string | null;

  @IsOptional()
  @IsUUID('4')
  milestoneId?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100000)
  content?: string | null;

  @IsOptional()
  @IsEnum(ProjectTicketPriority)
  priority?: ProjectTicketPriority;

  @IsOptional()
  @IsEnum(ProjectTicketStatus)
  status?: ProjectTicketStatus;

  @IsOptional()
  locked?: boolean;
}

export class ProjectTicketTasksDto {
  open!: number;
  done!: number;
  children!: { open: number; done: number };
}

export class ProjectTicketResponseDto {
  id!: string;
  projectId!: string;
  parentId?: string | null;
  milestoneId?: string | null;
  title!: string;
  content?: string | null;
  status!: ProjectTicketStatus;
  priority!: ProjectTicketPriority;
  shas!: { short: string; long: string };
  tasks!: ProjectTicketTasksDto;
  createdByUserId?: string | null;
  createdByEmail?: string;
  locked!: boolean;
  createdAt!: Date;
  updatedAt!: Date;
  children?: ProjectTicketResponseDto[];
}

export class CreateProjectTicketCommentDto {
  @IsString()
  @Length(1, 10000)
  body!: string;
}

export class ProjectTicketCommentResponseDto {
  id!: string;
  ticketId!: string;
  userId!: string;
  userEmail?: string;
  body!: string;
  createdAt!: Date;
}

export class ProjectTicketActivityResponseDto {
  id!: string;
  ticketId!: string;
  occurredAt!: Date;
  actorType!: string;
  actorUserId?: string | null;
  actionType!: string;
  payload!: Record<string, unknown>;
}
