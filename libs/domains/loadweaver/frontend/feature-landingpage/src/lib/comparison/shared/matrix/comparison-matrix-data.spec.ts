import { PORTAL_COMPARISON_NAV_ITEMS } from '../misc/comparison-nav.items';
import { COMPARISON_PAGES } from '../misc/comparison-pages';

import { buildComparisonMatrixRows, COMPARISON_MATRIX_ROW_LABELS } from './comparison-matrix-data';

describe('comparison matrix data', () => {
  it.each(PORTAL_COMPARISON_NAV_ITEMS.map((item) => item.slug))('has a full row set for %s', (slug) => {
    const rows = buildComparisonMatrixRows(slug);

    expect(rows).toHaveLength(COMPARISON_MATRIX_ROW_LABELS.length);
    rows.forEach((row) => {
      expect(row.loadweaver).toBe('strong');
      expect(row.loadweaverTooltip.length).toBeGreaterThan(0);
      expect(row.competitorTooltip.length).toBeGreaterThan(0);
    });
  });

  it('has a page config for every navigation item', () => {
    PORTAL_COMPARISON_NAV_ITEMS.forEach((item) => {
      expect(COMPARISON_PAGES[item.slug].slug).toBe(item.slug);
      expect(item.routerLink).toBe(`/compare/${item.slug}`);
    });
  });
});
