export class ProjectTicketAttachmentResponseDto {
  id!: string;
  ticketId!: string;
  fileName!: string;
  contentType!: string;
  byteSize!: number;
  downloadUrl!: string;
  createdByUserId?: string | null;
  createdAt!: Date;
}
