import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import {
  CREATABLE_AGENT_CHAT_SESSION_KINDS,
  type CreatableAgentChatSessionKind,
} from '../constants/chat-session.constants';

/**
 * DTO for creating a user-visible chat session under an agent.
 */
export class CreateChatSessionDto {
  @IsOptional()
  @IsString({ message: 'Title must be a string' })
  @MaxLength(255, { message: 'Title must be at most 255 characters' })
  title?: string;

  /** Defaults to `user`. `handoff` marks chats the controller opens for a task handed over by another agent. */
  @IsOptional()
  @IsIn(CREATABLE_AGENT_CHAT_SESSION_KINDS, { message: 'Kind must be user or handoff' })
  kind?: CreatableAgentChatSessionKind;
}
