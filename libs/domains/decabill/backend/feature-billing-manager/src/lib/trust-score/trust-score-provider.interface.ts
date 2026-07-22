import type { CustomerTrustScoreFactor } from './trust-score.types';

export interface TrustScoreProvider {
  id: string;
  evaluate(userId: string): Promise<CustomerTrustScoreFactor[]>;
}
