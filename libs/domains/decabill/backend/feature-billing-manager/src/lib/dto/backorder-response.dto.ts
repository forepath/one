import { BackorderStatus } from '../entities/backorder.entity';

export class BackorderResponseDto {
  id!: string;
  userId!: string;
  serviceTypeId!: string;
  planId!: string;
  status!: BackorderStatus;
  failureReason?: string;
  requestedConfigSnapshot!: Record<string, unknown>;
  providerErrors!: Record<string, unknown>;
  preferredAlternatives!: Record<string, unknown>;
  retryAfter?: Date;
  createdAt!: Date;
  updatedAt!: Date;
}
