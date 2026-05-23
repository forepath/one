import { formatAgenstraMetaDescription, formatAgenstraMetaTitle } from './page-meta.util';

const META_TITLE_SUFFIX = ' :: Agenstra';
const META_TITLE_MAX_LENGTH = 58;
const META_DESCRIPTION_MAX_LENGTH = 155;

describe('formatAgenstraMetaTitle', () => {
  it('appends the Agenstra suffix to a short page title', () => {
    expect(formatAgenstraMetaTitle('Documentation')).toBe(`Documentation${META_TITLE_SUFFIX}`);
  });

  it('trims surrounding whitespace from the page title', () => {
    expect(formatAgenstraMetaTitle('  Cloud  ')).toBe(`Cloud${META_TITLE_SUFFIX}`);
  });

  it('truncates long titles and keeps the result within the SERP limit', () => {
    const pageTitle = 'A'.repeat(80);
    const result = formatAgenstraMetaTitle(pageTitle);

    expect(result.endsWith(META_TITLE_SUFFIX)).toBe(true);
    expect(result.length).toBeLessThanOrEqual(META_TITLE_MAX_LENGTH);
    expect(result).toContain('…');
  });
});

describe('formatAgenstraMetaDescription', () => {
  it('returns a short description unchanged after trimming', () => {
    expect(formatAgenstraMetaDescription('Install and operate agent hosts.')).toBe('Install and operate agent hosts.');
  });

  it('trims surrounding whitespace from the description', () => {
    expect(formatAgenstraMetaDescription('  Short description.  ')).toBe('Short description.');
  });

  it('truncates long descriptions and keeps the result within the SERP limit', () => {
    const description = 'word '.repeat(80);
    const result = formatAgenstraMetaDescription(description);

    expect(result.length).toBeLessThanOrEqual(META_DESCRIPTION_MAX_LENGTH);
    expect(result.endsWith('…')).toBe(true);
  });
});
