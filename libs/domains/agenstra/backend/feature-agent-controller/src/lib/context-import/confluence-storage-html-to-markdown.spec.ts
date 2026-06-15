import {
  confluenceStorageHtmlToMarkdown,
  confluenceStorageHtmlToPlainFallback,
} from './confluence-storage-html-to-markdown';

describe('confluenceStorageHtmlToMarkdown', () => {
  it('converts headings and paragraphs with local-id stripped', () => {
    const html =
      '<h2 local-id="x">Purpose</h2>' + '<p local-id="y">This guide documents the <code>.historicwork_cfg</code>.</p>';
    const md = confluenceStorageHtmlToMarkdown(html);

    expect(md).toContain('## Purpose');
    expect(md).toContain('`.historicwork_cfg`');
  });

  it('converts ul/li/p to a tight bullet list', () => {
    const html =
      '<ul local-id="u1">' +
      '<li local-id="l1"><p local-id="p1">Existing repositories only.</p></li>' +
      '<li local-id="l2"><p local-id="p2">Discovery-first workflow.</p></li>' +
      '</ul>';
    const md = confluenceStorageHtmlToMarkdown(html);

    expect(md).toMatch(/^- Existing repositories only\.\n- Discovery-first workflow\./m);
    expect(md).not.toMatch(/\n\n- Discovery/);
  });

  it('converts simple tables to standard GFM pipe rows (single line per row)', () => {
    const html =
      '<table><tbody><tr><th><p>A</p></th><th><p>B</p></th></tr>' +
      '<tr><td><p>1</p></td><td><p>2</p></td></tr></tbody></table>';
    const md = confluenceStorageHtmlToMarkdown(html);

    expect(md).toContain('| A | B |');
    expect(md).toContain('| --- | --- |');
    expect(md).toContain('| 1 | 2 |');
    expect(md).not.toMatch(/\|\s*\n\s*A/);
    expect(md).not.toMatch(/\|\s*\n\s*1/);
  });

  it('converts ol/li/p with start attribute', () => {
    const html =
      '<ol start="1" local-id="o1">' +
      '<li local-id="a"><p local-id="p">First step.</p></li>' +
      '<li local-id="b"><p local-id="q">Second step.</p></li>' +
      '</ol>';
    const md = confluenceStorageHtmlToMarkdown(html);

    expect(md).toMatch(/^1\. First step\.\n2\. Second step\./m);
  });

  it('maps ac:link with ri:page to a markdown link', () => {
    const html =
      '<p>Aligned: <ac:link ac:local-id="z">' +
      '<ri:page ri:content-title="My Page Title" ri:version-at-save="1" />' +
      '<ac:link-body>My Page Title</ac:link-body></ac:link></p>';
    const md = confluenceStorageHtmlToMarkdown(html);

    expect(md).toContain('[My Page Title](confluence-page:');
    expect(md).toContain(encodeURIComponent('My Page Title'));
  });

  it('omits fence language when parameter is not a safe id', () => {
    const html =
      '<ac:structured-macro ac:name="code">' +
      '<ac:parameter ac:name="language">not a valid lang!</ac:parameter>' +
      '<ac:plain-text-body><![CDATA[hi]]></ac:plain-text-body>' +
      '</ac:structured-macro>';
    const md = confluenceStorageHtmlToMarkdown(html);

    expect(md).toContain('```');
    expect(md).toContain('hi');
    expect(md.split('\n').find((line) => line.startsWith('```'))).toBe('```');
  });

  it('converts code structured macro to a fenced markdown block', () => {
    const html =
      '<p>Before</p><ac:structured-macro ac:name="code" ac:schema-version="1">' +
      '<ac:parameter ac:name="language">typescript</ac:parameter>' +
      '<ac:plain-text-body><![CDATA[const x = 1;\nconsole.log(x);]]></ac:plain-text-body>' +
      '</ac:structured-macro><p>After</p>';
    const md = confluenceStorageHtmlToMarkdown(html);

    expect(md).toContain('```typescript');
    expect(md).toContain('const x = 1;');
    expect(md).toContain('```');
    expect(md).not.toContain('Macro: code');
  });

  it('converts panel structured macro to title and rich body markdown', () => {
    const html =
      '<ac:structured-macro ac:name="panel" ac:schema-version="1">' +
      '<ac:parameter ac:name="title">Note</ac:parameter>' +
      '<ac:rich-text-body><p local-id="x">Inside panel.</p><p local-id="y">Second line.</p></ac:rich-text-body>' +
      '</ac:structured-macro>';
    const md = confluenceStorageHtmlToMarkdown(html);

    expect(md).toContain('**Note**');
    expect(md).toContain('Inside panel');
    expect(md).toContain('Second line');
    expect(md).not.toContain('Macro: panel');
  });

  it('converts panel with single-quoted ac:name and reversed opening attributes', () => {
    const html =
      "<ac:structured-macro ac:schema-version='1' ac:name='panel'>" +
      '<ac:rich-text-body><p>Body only.</p></ac:rich-text-body>' +
      '</ac:structured-macro>';

    expect(confluenceStorageHtmlToMarkdown(html)).toContain('Body only');
  });

  it('converts panel that wraps a nested code macro', () => {
    const html =
      '<ac:structured-macro ac:name="panel">' +
      '<ac:parameter ac:name="title">Outer</ac:parameter>' +
      '<ac:rich-text-body><p>Intro</p>' +
      '<ac:structured-macro ac:name="code">' +
      '<ac:plain-text-body><![CDATA[ok();]]></ac:plain-text-body>' +
      '</ac:structured-macro>' +
      '</ac:rich-text-body>' +
      '</ac:structured-macro>';
    const md = confluenceStorageHtmlToMarkdown(html);

    expect(md).toContain('**Outer**');
    expect(md).toContain('Intro');
    expect(md).toContain('```');
    expect(md).toContain('ok();');
    expect(md).not.toContain('Macro: panel');
  });

  it('converts panel body without ac:rich-text-body wrapper', () => {
    const html =
      '<ac:structured-macro ac:name="panel">' +
      '<ac:parameter ac:name="borderWidth">1</ac:parameter>' +
      '<p local-id="z">Loose paragraph.</p>' +
      '</ac:structured-macro>';

    expect(confluenceStorageHtmlToMarkdown(html)).toContain('Loose paragraph');
  });

  it('replaces view-file structured macro with attachment line', () => {
    const html =
      '<p class="media-group">' +
      '<ac:structured-macro ac:name="view-file" ac:schema-version="1">' +
      '<ac:parameter ac:name="name"><ri:attachment ri:filename="bundle.zip" ri:version-at-save="1" /></ac:parameter>' +
      '</ac:structured-macro></p>';
    const md = confluenceStorageHtmlToMarkdown(html);

    expect(md.toLowerCase()).toContain('attachment');
    expect(md).toContain('bundle.zip');
  });

  it('converts jira macro with issue key to a markdown link', () => {
    const html =
      '<ac:structured-macro ac:name="jira" ac:schema-version="1">' +
      '<ac:parameter ac:name="key">PROJ-42</ac:parameter>' +
      '</ac:structured-macro>';
    const md = confluenceStorageHtmlToMarkdown(html);

    expect(md).toContain('[PROJ-42](jira-issue:');
    expect(md).toContain(encodeURIComponent('PROJ-42'));
    expect(md).not.toContain('Macro: jira');
  });

  it('converts jiraissues macro with jql to readable text', () => {
    const html =
      '<ac:structured-macro ac:name="jiraissues">' +
      '<ac:parameter ac:name="jqlQuery">project = PROJ ORDER BY created DESC</ac:parameter>' +
      '<ac:parameter ac:name="maximumIssues">10</ac:parameter>' +
      '</ac:structured-macro>';
    const md = confluenceStorageHtmlToMarkdown(html);

    expect(md.toLowerCase()).toContain('jira issues');
    expect(md).toContain('project = PROJ');
    expect(md).toContain('10');
    expect(md).not.toContain('Macro: jiraissues');
  });

  it('converts jira macro with rich-text-body', () => {
    const html =
      '<ac:structured-macro ac:name="jira">' +
      '<ac:rich-text-body><p local-id="z">Issue summary here</p></ac:rich-text-body>' +
      '</ac:structured-macro>';
    const md = confluenceStorageHtmlToMarkdown(html);

    expect(md).toContain('Issue summary here');
    expect(md).not.toContain('Macro: jira');
  });

  it('returns empty string for blank input', () => {
    expect(confluenceStorageHtmlToMarkdown('')).toBe('');
    expect(confluenceStorageHtmlToMarkdown('   ')).toBe('');
  });

  it('plain fallback returns empty for blank or undefined-like input', () => {
    expect(confluenceStorageHtmlToPlainFallback('')).toBe('');
    expect(confluenceStorageHtmlToPlainFallback('   ')).toBe('');
    expect(confluenceStorageHtmlToPlainFallback(undefined as unknown as string)).toBe('');
  });

  it('renders unknown structured macro as readable macro line', () => {
    const html = '<ac:structured-macro ac:name="gliffy"></ac:structured-macro>';
    const md = confluenceStorageHtmlToMarkdown(html);

    expect(md).toContain('Macro: gliffy');
  });

  it('renders code macro without plain body as macro fallback', () => {
    const html = '<ac:structured-macro ac:name="code"></ac:structured-macro>';
    const md = confluenceStorageHtmlToMarkdown(html);

    expect(md).toContain('Macro: code');
  });

  it('maps jira macro using issueKey parameter', () => {
    const html =
      '<ac:structured-macro ac:name="jira">' +
      '<ac:parameter ac:name="issueKey">ABC-9</ac:parameter>' +
      '</ac:structured-macro>';
    const md = confluenceStorageHtmlToMarkdown(html);

    expect(md).toContain('[ABC-9](jira-issue:');
  });

  it('includes columns metadata for jiraissues macro when present', () => {
    const html =
      '<ac:structured-macro ac:name="jiraissues">' +
      '<ac:parameter ac:name="jqlQuery">project = X</ac:parameter>' +
      '<ac:parameter ac:name="maximumIssues">5</ac:parameter>' +
      '<ac:parameter ac:name="columns">summary,status</ac:parameter>' +
      '</ac:structured-macro>';
    const md = confluenceStorageHtmlToMarkdown(html);

    expect(md.toLowerCase()).toContain('jira issues');
    expect(md).toContain('summary,status');
  });

  it('decodes numeric apostrophe entity in visible text', () => {
    const html = '<p>It&#39;s fine.</p>';
    const md = confluenceStorageHtmlToMarkdown(html);

    expect(md).toContain("It's fine");
  });

  it('uses ri:content-title when ac:link-body is absent', () => {
    const html = '<p><ac:link><ri:page ri:content-title="Only Title" /></ac:link></p>';
    const md = confluenceStorageHtmlToMarkdown(html);

    expect(md).toContain('[Only Title](confluence-page:');
    expect(md).toContain(encodeURIComponent('Only Title'));
  });

  it('plain fallback preserves line breaks instead of one long line', () => {
    const html =
      '<h2>Purpose</h2><p>First paragraph.</p><ul><li><p>Item one</p></li><li><p>Item two</p></li></ul>' +
      '<table><tbody><tr><th><p>A</p></th><th><p>B</p></th></tr></tbody></table>';
    const plain = confluenceStorageHtmlToPlainFallback(html);

    expect(plain.split('\n').length).toBeGreaterThan(3);
    expect(plain).toContain('Purpose');
    expect(plain).toContain('Item one');
    expect(plain).not.toMatch(/^[^\n]{200,}$/);
  });

  it('converts minified storage-like HTML with many block tags to multi-line markdown', () => {
    const html =
      '<h2 local-id="a">Alpha</h2><p local-id="b">Body one.</p><h3 local-id="c">Beta</h3><p local-id="d">Body two.</p>';
    const md = confluenceStorageHtmlToMarkdown(html);

    expect(md.split('\n').filter((l) => l.trim().length > 0).length).toBeGreaterThanOrEqual(4);
  });
});
