export type ComparisonSlug = 'kubernetes' | 'docker-swarm' | 'nomad' | 'coolify-dokploy' | 'portainer';

export type MatrixStrength = 'strong' | 'partial' | 'weak' | 'na';

export interface ComparisonMatrixRowLabel {
  readonly dimension: string;
  readonly question: string;
}

export interface ComparisonMatrixRowViewModel extends ComparisonMatrixRowLabel {
  readonly loadweaver: MatrixStrength;
  readonly loadweaverTooltip: string;
  readonly competitor: MatrixStrength;
  readonly competitorTooltip: string;
}
