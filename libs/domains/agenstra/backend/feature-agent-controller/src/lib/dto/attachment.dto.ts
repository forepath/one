export class AttachmentResponseDto {
  id!: string;
  clientId!: string;
  ownerType!: string;
  ownerId!: string;
  fileName!: string;
  contentType!: string;
  byteSize!: number;
  contentSha256!: string;
  downloadUrl!: string;
  /** Absolute read-only path where this file is mirrored inside agent containers when used as chat context. */
  agentPath?: string | null;
  createdByUserId?: string | null;
  createdAt!: Date;
}
