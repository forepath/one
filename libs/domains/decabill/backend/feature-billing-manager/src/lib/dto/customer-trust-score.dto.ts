import type { CustomerTrustLevel } from '../trust-score/trust-score.types';

export class CustomerTrustScoreFactorDto {
  id!: string;
  label!: string;
  description!: string;
  points!: number;
  source!: string;
  metadata?: Record<string, unknown>;
}

export class CustomerTrustScoreResponseDto {
  profileId!: string;
  userId!: string;
  score!: number;
  level!: CustomerTrustLevel;
  baseScore!: number;
  factors!: CustomerTrustScoreFactorDto[];
  computedAt!: Date;
  sources!: string[];
}
