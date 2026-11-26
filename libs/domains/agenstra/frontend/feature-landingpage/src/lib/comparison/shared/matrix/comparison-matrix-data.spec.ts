import { buildComparisonMatrixRows, COMPARISON_MATRIX_ROW_LABELS } from './comparison-matrix-data';
import type { ComparisonSlug } from './comparison-matrix.model';

const SLUGS: readonly ComparisonSlug[] = [
  'devin',
  'cursor',
  'github-copilot',
  'codeium-windsurf',
  'tabnine-enterprise',
  'portkey',
  'orq-ai',
];

describe('buildComparisonMatrixRows', () => {
  it.each(SLUGS)('builds a complete row for every capability for %s', (slug) => {
    const rows = buildComparisonMatrixRows(slug);

    expect(rows).toHaveLength(COMPARISON_MATRIX_ROW_LABELS.length);

    for (const row of rows) {
      expect(row.dimension).not.toBe('');
      expect(row.agenstraTooltip).not.toBe('');
      expect(row.competitorTooltip).not.toBe('');
    }
  });
});
