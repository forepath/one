import { atlassianWikiMarkupToMarkdown, looksLikeAtlassianWikiMarkup } from './atlassian-wiki-markup-to-markdown';

describe('looksLikeAtlassianWikiMarkup', () => {
  it('is false for plain prose', () => {
    expect(looksLikeAtlassianWikiMarkup('Just some text without wiki tokens.')).toBe(false);
  });

  it('detects wiki macro and heading markers', () => {
    expect(looksLikeAtlassianWikiMarkup('{code}x{code}')).toBe(true);
    expect(looksLikeAtlassianWikiMarkup('h1. Title line')).toBe(true);
    expect(looksLikeAtlassianWikiMarkup('||a||b||\n|1|2|')).toBe(true);
    expect(looksLikeAtlassianWikiMarkup('[~jdoe]')).toBe(true);
  });
});

describe('atlassianWikiMarkupToMarkdown', () => {
  it('converts hn. headings to ATX markdown', () => {
    const md = atlassianWikiMarkupToMarkdown('h2. Section\n\nBody');

    expect(md).toContain('## Section');
    expect(md).toContain('Body');
  });

  it('maps wiki *strong* and _emphasis_ to markdown emphasis', () => {
    const md = atlassianWikiMarkupToMarkdown('*strong* and _emphasis_');

    expect(md).toContain('**strong**');
    expect(md).toContain('*emphasis*');
  });

  it('converts {code} macro to fenced code', () => {
    const md = atlassianWikiMarkupToMarkdown('{code:java}\nreturn x;\n{code}');

    expect(md).toContain('```java');
    expect(md).toContain('return x;');
    expect(md).toContain('```');
  });

  it('converts wiki table rows to a markdown table', () => {
    const wiki = '||heading 1||heading 2||\n|col A1|col A2|';
    const md = atlassianWikiMarkupToMarkdown(wiki);

    expect(md).toMatch(/\| heading 1 \| heading 2 \|/);
    expect(md).toMatch(/\| --- \| --- \|/);
    expect(md).toMatch(/\| col A1 \| col A2 \|/);
  });

  it('turns [Label|url] into markdown links', () => {
    const md = atlassianWikiMarkupToMarkdown('[Atlassian|http://atlassian.com]');

    expect(md).toBe('[Atlassian](http://atlassian.com)');
  });

  it('maps wiki inserted, superscript, and subscript without HTML tags', () => {
    const md = atlassianWikiMarkupToMarkdown('+inserted+ ^sup^ and ~sub~');

    expect(md).not.toMatch(/<[a-z]/i);
    expect(md).toContain('**inserted**');
    expect(md).toContain('^sup^');
    expect(md).toContain('~sub~');
  });

  it('does not emit ~~ for hyphenated phrases (wiki -strike- disabled)', () => {
    expect(atlassianWikiMarkupToMarkdown('see foo-bar-baz and -maybe- strike')).not.toContain('~~');
    expect(atlassianWikiMarkupToMarkdown('see foo-bar-baz and -maybe- strike')).toContain('foo-bar-baz');
  });

  it('does not treat GFM checkbox lines as wiki strikethrough (hyphen in label)', () => {
    const md = atlassianWikiMarkupToMarkdown('h1. Tasks\n\n- [ ] fix foo-bar\n- [x] done');

    expect(md).toContain('- [ ] fix foo-bar');
    expect(md).toContain('- [x] done');
    expect(md).not.toContain('~~');
  });

  it('maps horizontal rule ---- to markdown hr', () => {
    const md = atlassianWikiMarkupToMarkdown('before\n----\nafter');

    expect(md).toContain('---');
    expect(md).toContain('before');
    expect(md).toContain('after');
  });
});
