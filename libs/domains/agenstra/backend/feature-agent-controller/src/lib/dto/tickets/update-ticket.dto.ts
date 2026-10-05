import { IsEnum, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateIf } from 'class-validator';

import { TicketPriority, TicketStatus } from '../../entities/ticket.enums';
import { PREFERRED_MODEL_PATTERN } from '../../utils/preferred-model.utils';

export class UpdateTicketDto {
  @IsOptional()
  @IsUUID('4')
  clientId?: string;

  @IsOptional()
  @IsUUID('4')
  parentId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;

  /** Persist which workspace agent to use for chat/AI on this ticket; set `null` to clear. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsUUID('4')
  preferredChatAgentId?: string | null;

  /** Persist OpenCode `provider/model` for chat/AI on this ticket; set `null` to clear. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(256)
  @Matches(PREFERRED_MODEL_PATTERN)
  preferredChatModel?: string | null;
}
