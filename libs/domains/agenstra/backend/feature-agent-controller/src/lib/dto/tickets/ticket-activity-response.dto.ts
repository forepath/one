import { TicketActorType } from '../../entities/ticket.enums';

export class TicketActivityResponseDto {
  id!: string;
  ticketId!: string;
  occurredAt!: Date;
  actorType!: TicketActorType;
  actorUserId?: string | null;
  actorEmail?: string | null;
  actionType!: string;
  payload!: Record<string, unknown>;
}
