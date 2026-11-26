import { buildComparisonMatrixRows, COMPARISON_MATRIX_ROW_LABELS } from './comparison-matrix-data';
import type { ComparisonSlug } from './comparison-matrix.model';

const SLUGS: readonly ComparisonSlug[] = ['whmcs', 'hostbill', 'stripe-billing', 'chargebee', 'paddle'];

describe('buildComparisonMatrixRows', () => {
  it('has fourteen capabilities, as the matrix intro says', () => {
    expect(COMPARISON_MATRIX_ROW_LABELS).toHaveLength(14);
  });

  it.each(SLUGS)('builds a complete row for every capability for %s', (slug) => {
    const rows = buildComparisonMatrixRows(slug);

    expect(rows).toHaveLength(COMPARISON_MATRIX_ROW_LABELS.length);

    for (const row of rows) {
      expect(row.dimension).not.toBe('');
      expect(row.question).not.toBe('');
      expect(row.decabill).toBe('strong');
      expect(row.decabillTooltip).not.toBe('');
      expect(['strong', 'partial', 'weak', 'na']).toContain(row.competitor);
      expect(row.competitorTooltip).not.toBe('');
    }
  });

  it('scores the offers and projects capability per competitor', () => {
    const last = (slug: ComparisonSlug) => buildComparisonMatrixRows(slug).at(-1);

    expect(last('whmcs')?.dimension).toBe('Offers, projects, and time billing');
    expect(SLUGS.map((slug) => last(slug)?.competitor)).toEqual(['partial', 'partial', 'partial', 'partial', 'weak']);
  });
});
