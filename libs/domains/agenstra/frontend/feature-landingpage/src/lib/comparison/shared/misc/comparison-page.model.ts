import type { ComparisonSlug } from '../matrix/comparison-matrix.model';

/**
 * Shared page contract for every “{Competitor} vs Agenstra” route.
 *
 * Structural concept (same order on all pages):
 * 1. Hero: competitor name and a consistent subtitle pattern.
 * 2. Overview: two lead paragraphs (them vs us).
 * 3. Feature matrix: identical 13-row rubric; only the competitor column changes.
 * 4. Technology fit: closing message on choosing a stack, with a fair tilt toward Agenstra where it applies.
 */
export interface ComparisonPageConfig {
  readonly slug: ComparisonSlug;
  readonly competitorDisplayName: string;
  readonly metaTitle: string;
  readonly metaDescription: string;
  readonly canonicalUrl: string;
  readonly heroSubtitle: string;
  readonly overviewCompetitorLead: string;
  readonly overviewAgenstraLead: string;
  readonly technologyFitLead: string;
}
