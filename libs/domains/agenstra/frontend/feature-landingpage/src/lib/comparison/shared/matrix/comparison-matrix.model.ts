export type ComparisonSlug =
  | 'devin'
  | 'cursor'
  | 'github-copilot'
  | 'codeium-windsurf'
  | 'tabnine-enterprise'
  | 'portkey'
  | 'orq-ai';

export type MatrixStrength = 'strong' | 'partial' | 'weak' | 'na';

export interface ComparisonMatrixRowLabel {
  readonly dimension: string;
  readonly question: string;
}

export interface ComparisonMatrixRowViewModel extends ComparisonMatrixRowLabel {
  readonly agenstra: MatrixStrength;
  readonly agenstraTooltip: string;
  readonly competitor: MatrixStrength;
  readonly competitorTooltip: string;
}
