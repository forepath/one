export enum CustomerTrustLevel {
  GREEN = 'green',
  YELLOW = 'yellow',
  RED = 'red',
}

export interface CustomerTrustScoreFactor {
  id: string;
  label: string;
  description: string;
  points: number;
  source: string;
  metadata?: Record<string, unknown>;
}

export interface CustomerTrustScoreSummary {
  score: number;
  level: CustomerTrustLevel;
  baseScore: number;
  factors: CustomerTrustScoreFactor[];
  computedAt: Date;
  sources: string[];
}
