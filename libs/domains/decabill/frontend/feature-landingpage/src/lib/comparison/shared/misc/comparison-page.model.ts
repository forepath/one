import type { ComparisonSlug } from '../matrix/comparison-matrix.model';

export interface ComparisonPageConfig {
  readonly slug: ComparisonSlug;
  readonly competitorDisplayName: string;
  readonly metaTitle: string;
  readonly metaDescription: string;
  readonly canonicalUrl: string;
  readonly heroSubtitle: string;
  readonly overviewCompetitorLead: string;
  readonly overviewDecabillLead: string;
  readonly technologyFitLead: string;
}
