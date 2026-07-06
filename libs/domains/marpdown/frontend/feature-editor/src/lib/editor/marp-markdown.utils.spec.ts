import {
  countMarpSlides,
  defaultMarpFrontmatter,
  disablePaginationInMarkdown,
  joinMarpMarkdown,
  splitMarpMarkdown,
} from './marp-markdown.utils';

describe('marp-markdown.utils', () => {
  it('splits marp frontmatter from slide body', () => {
    const markdown = `---
marp: true
theme: default
---

# Slide one

---

## Slide two
`;

    expect(splitMarpMarkdown(markdown)).toEqual({
      frontmatter: 'marp: true\ntheme: default',
      body: '# Slide one\n\n---\n\n## Slide two\n',
    });
  });

  it('returns full markdown when no frontmatter delimiter is present', () => {
    const markdown = '# Title\n\n---\n\nBody';

    expect(splitMarpMarkdown(markdown)).toEqual({
      frontmatter: null,
      body: markdown,
    });
  });

  it('joins frontmatter and body with marp delimiters', () => {
    expect(
      joinMarpMarkdown({
        frontmatter: 'marp: true\ntheme: gaia',
        body: '# Hello',
      }),
    ).toBe('---\nmarp: true\ntheme: gaia\n---\n# Hello');
  });

  it('returns body only when frontmatter is empty', () => {
    expect(
      joinMarpMarkdown({
        frontmatter: '   ',
        body: '# Hello',
      }),
    ).toBe('# Hello');
  });

  it('counts slides from horizontal rules outside fenced code blocks', () => {
    const body = `# One

\`\`\`md
---
\`\`\`

---

## Two`;

    expect(countMarpSlides(body)).toBe(2);
  });

  it('provides default marp frontmatter', () => {
    expect(defaultMarpFrontmatter()).toContain('marp: true');
  });

  it('disables pagination in frontmatter for presenter rendering', () => {
    const markdown = `---
marp: true
theme: default
paginate: true
---

# Slide
`;

    expect(disablePaginationInMarkdown(markdown)).toContain('paginate: false');
    expect(disablePaginationInMarkdown(markdown)).not.toContain('paginate: true');
  });
});
