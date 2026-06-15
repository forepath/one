export class TicketCommentResponseDto {
  id!: string;
  ticketId!: string;
  authorUserId?: string | null;
  authorEmail?: string | null;
  body!: string;
  createdAt!: Date;
}
