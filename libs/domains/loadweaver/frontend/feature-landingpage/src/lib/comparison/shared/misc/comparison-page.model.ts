import type { ComparisonSlug } from '../matrix/comparison-matrix.model';

/**
 * Shared page contract for every “{Competitor} vs Loadweaver” route.
 *
 * Structure (same order on all pages): hero, two overview leads (them vs us), the ten-row matrix, and a
 * closing technology-fit message. Copy stays factual: no claims about competitors beyond what they
 * publicly document.
 */
export interface ComparisonPageConfig {
  readonly slug: ComparisonSlug;
  readonly competitorDisplayName: string;
  readonly metaTitle: string;
  readonly metaDescription: string;
  readonly heroSubtitle: string;
  readonly overviewCompetitorLead: string;
  readonly overviewLoadweaverLead: string;
}

/** Route data key that carries the slug of a comparison route. */
export const COMPARISON_SLUG_DATA_KEY = 'comparisonSlug';
