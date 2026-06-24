export type ComparisonSlug = 'whmcs' | 'hostbill' | 'stripe-billing' | 'chargebee' | 'paddle';

export type MatrixStrength = 'strong' | 'partial' | 'weak' | 'na';

export interface ComparisonMatrixRowLabel {
  readonly dimension: string;
  readonly question: string;
}

export interface ComparisonMatrixRowViewModel extends ComparisonMatrixRowLabel {
  readonly decabill: MatrixStrength;
  readonly decabillTooltip: string;
  readonly competitor: MatrixStrength;
  readonly competitorTooltip: string;
}
