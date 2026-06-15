import { IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

import { TicketCreationTemplate, TicketPriority, TicketStatus } from '../../entities/ticket.enums';

export class CreateTicketDto {
  @IsOptional()
  @IsUUID('4', { message: 'clientId must be a UUID' })
  clientId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'parentId must be a UUID' })
  parentId?: string | null;

  @IsNotEmpty({ message: 'title is required' })
  @IsString()
  @MaxLength(500)
  title!: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;

  /** Not persisted. `specification` is only allowed for root tickets (no `parentId`). */
  @IsOptional()
  @IsEnum(TicketCreationTemplate)
  creationTemplate?: TicketCreationTemplate;
}
