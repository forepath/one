import type TurndownService from 'turndown';

/**
 * Converts Confluence editor / storage HTML fragments (XHTML-like, `local-id`, `ac:*`, `ri:*`)
 * to Markdown for imported knowledge pages. Uses Turndown + GFM **tables** only (no plugin
 * strikethrough/task-list rules) and Confluence-specific preprocessing.
 */

function decodeBasicEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Minified Confluence HTML is often `</h2><p>` with no whitespace; this helps parsers and plain-text fallbacks keep block boundaries. */
const BLOCK_TAG_AFTER_LT =
  /^\s*<\/?(?:h[1-6]|p|ul|ol|li|table|tbody|thead|tfoot|tr|th|td|blockquote|pre|div|section|article|aside|nav|header|footer|hr|dl|dt|dd|figure|figcaption)\b/i;

function insertNewlinesBeforeBlockOpens(html: string): string {
  return html.replace(/>(\s*)</g, (full, ws: string, offset: number, str: string) => {
    const afterLt = str.slice(offset + 1 + ws.length);

    if (BLOCK_TAG_AFTER_LT.test(afterLt) && !ws.includes('\n')) {
      return '>\n<';
    }

    return full;
  });
}

/**
 * Last-resort conversion when Turndown throws: keeps line breaks at block boundaries instead of
 * collapsing the whole document into one line (which made tables/lists unreadable).
 */
export function confluenceStorageHtmlToPlainFallback(html: string): string {
  if (!html?.trim()) {
    return '';
  }

  let s = insertNewlinesBeforeBlockOpens(html);

  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = decodeBasicEntities(s.replace(/<[^>]+>/g, ' '));
  s = s
    .replace(/[ \t\f\v\r]+/g, ' ')
    .replace(/ \n/g, '\n')
    .replace(/\n /g, '\n');

  return s.replace(/\n{3,}/g, '\n\n').trim();
}

function stripInnerHtmlTags(html: string): string {
  return decodeBasicEntities(html.replace(/<[^>]+>/g, '').trim());
}

function escapeHtmlTextContent(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeRegexParamName(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `ac:name` may use single or double quotes and appear in any attribute order on the opening tag. */
function extractStructuredMacroName(full: string): string {
  const dq = full.match(/\bac:name\s*=\s*"([^"]+)"/i);

  if (dq) {
    return dq[1];
  }

  const sq = full.match(/\bac:name\s*=\s*'([^']+)'/i);

  return sq?.[1] ?? 'macro';
}

function extractAcParameterPlainText(inner: string, paramName: string): string | null {
  const escaped = escapeRegexParamName(paramName);
  const re = new RegExp(
    `<ac:parameter\\b[^>]*\\bac:name\\s*=\\s*["']${escaped}["'][^>]*>([\\s\\S]*?)</ac:parameter>`,
    'i',
  );
  const m = inner.match(re);

  if (!m) {
    return null;
  }

  const t = stripInnerHtmlTags(m[1]).trim();

  return t.length > 0 ? t : null;
}

/** Confluence `ac:plain-text-body`, often wrapped in CDATA. */
function extractMacroPlainTextBody(inner: string): string | null {
  const m = inner.match(/<ac:plain-text-body\b[^>]*>([\s\S]*?)<\/ac:plain-text-body>/i);

  if (!m) {
    return null;
  }

  let t = m[1].trim();
  const cdata = /^<!\[CDATA\[([\s\S]*)\]\]>$/i.exec(t);

  if (cdata) {
    t = cdata[1];
  }

  t = decodeBasicEntities(t);

  return t.length > 0 ? t : null;
}

/** Confluence `ac:rich-text-body` (storage XHTML inside macros such as `panel`). */
function extractMacroRichTextBodyHtml(inner: string): string | null {
  const m = inner.match(/<ac:rich-text-body\b[^>]*>([\s\S]*?)<\/ac:rich-text-body>/i);

  if (!m) {
    return null;
  }

  let t = m[1].trim();
  const cdata = /^<!\[CDATA\[([\s\S]*)\]\]>$/i.exec(t);

  if (cdata) {
    t = cdata[1].trim();
  }

  return t.length > 0 ? t : null;
}

/** Some panels omit `ac:rich-text-body` and place block markup after parameters. */
function extractPanelInnerHtmlFallback(inner: string): string | null {
  const s = inner.replace(/<ac:parameter\b[^>]*>[\s\S]*?<\/ac:parameter>/gi, '').trim();

  if (!s) {
    return null;
  }

  return s.length > 0 ? s : null;
}

/**
 * Jira issue / Jira issues macro: rich body if present, else `key` or `jqlQuery` parameters.
 * Confluence storage uses `ac:name="jira"` / `jiraissues` with `ac:parameter` keys.
 */
function buildJiraMacroReplacementHtml(inner: string): string | null {
  const rich = extractMacroRichTextBodyHtml(inner);

  if (rich != null) {
    return `<div>${rich}</div>`;
  }

  const issueKey =
    extractAcParameterPlainText(inner, 'key') ??
    extractAcParameterPlainText(inner, 'issueKey') ??
    extractAcParameterPlainText(inner, 'issuekey');

  if (issueKey) {
    const href = `jira-issue:${encodeURIComponent(issueKey)}`;

    return `<p><a href="${href}">${escapeHtmlTextContent(issueKey)}</a></p>`;
  }

  const jql = extractAcParameterPlainText(inner, 'jqlQuery') ?? extractAcParameterPlainText(inner, 'jql');

  if (jql) {
    const maxIssues = extractAcParameterPlainText(inner, 'maximumIssues');
    const columns = extractAcParameterPlainText(inner, 'columns');
    const metaBits: string[] = [];

    if (maxIssues) {
      metaBits.push(`max ${maxIssues}`);
    }

    if (columns) {
      metaBits.push(columns);
    }

    const meta = metaBits.length > 0 ? ` (${escapeHtmlTextContent(metaBits.join(', '))})` : '';

    return `<p><em>Jira issues${meta}</em>: ${escapeHtmlTextContent(jql)}</p>`;
  }

  return null;
}

/** Turndown reads `class="language-…"` on `<code>` for fenced block language. */
function sanitizeFenceLanguageId(raw: string): string {
  const t = raw.trim().toLowerCase();

  if (!t || !/^[a-z0-9+#.-]{1,32}$/.test(t)) {
    return '';
  }

  return t.slice(0, 32);
}

/** Inline page links (`ac:link` + `ri:page` + optional `ac:link-body`) → `<a href="confluence-page:…">`. */
function replaceConfluenceAcLinks(html: string): string {
  return html.replace(/<ac:link\b[^>]*>([\s\S]*?)<\/ac:link>/gi, (_, inner: string) => {
    const bodyMatch = inner.match(/<ac:link-body>([\s\S]*?)<\/ac:link-body>/i);
    const titleVal = inner.match(/\bri:content-title="([^"]*)"/i);
    const rawLabel = bodyMatch?.[1]?.trim() ?? '';
    const label = rawLabel ? stripInnerHtmlTags(rawLabel) : decodeBasicEntities(titleVal?.[1] ?? 'Link');
    const pageKey = (titleVal?.[1] ?? (rawLabel.replace(/<[^>]+>/g, '').trim() || label)).trim();
    const href = `confluence-page:${encodeURIComponent(pageKey)}`;

    return `<a href="${href}">${label}</a>`;
  });
}

/**
 * Innermost `ac:structured-macro` first: a non-greedy match stops at the first `</ac:structured-macro>`,
 * which breaks outer panels when a nested macro exists. Repeat until stable.
 */
const STRUCTURED_MACRO_INNERMOST =
  /<ac:structured-macro\b[^>]*>((?:(?!<ac:structured-macro\b)[\s\S])*?)<\/ac:structured-macro>/gi;

function replaceOneStructuredMacro(full: string, inner: string): string {
  const name = extractStructuredMacroName(full);
  const fileMatch = inner.match(/\bri:filename="([^"]+)"/i) ?? inner.match(/\bri:filename='([^']+)'/i);

  if (fileMatch?.[1]) {
    return `<p><em>Attachment (${decodeBasicEntities(name)}): ${decodeBasicEntities(fileMatch[1])}</em></p>`;
  }

  if (name.toLowerCase() === 'code') {
    const body = extractMacroPlainTextBody(inner);

    if (body != null) {
      const langRaw =
        extractAcParameterPlainText(inner, 'language') ?? extractAcParameterPlainText(inner, 'title') ?? '';
      const langId = sanitizeFenceLanguageId(langRaw);
      const langClass = langId ? ` class="language-${langId}"` : '';

      return `<pre><code${langClass}>${escapeHtmlTextContent(body)}</code></pre>`;
    }
  }

  if (name.toLowerCase() === 'panel') {
    const richHtml = extractMacroRichTextBodyHtml(inner) ?? extractPanelInnerHtmlFallback(inner);
    const plainBody = extractMacroPlainTextBody(inner);
    const rich = richHtml != null ? richHtml : plainBody != null ? `<p>${escapeHtmlTextContent(plainBody)}</p>` : null;
    const titleText =
      extractAcParameterPlainText(inner, 'title') ??
      extractAcParameterPlainText(inner, 'panelTitle') ??
      extractAcParameterPlainText(inner, 'heading');

    if (rich != null || titleText) {
      const titleBlock = titleText ? `<p><strong>${escapeHtmlTextContent(titleText)}</strong></p>` : '';

      return `<div>${titleBlock}${rich ?? ''}</div>`;
    }
  }

  if (name.toLowerCase() === 'jira' || name.toLowerCase() === 'jiraissues') {
    const jiraHtml = buildJiraMacroReplacementHtml(inner);

    if (jiraHtml != null) {
      return jiraHtml;
    }
  }

  return `<p><em>Macro: ${decodeBasicEntities(name)}</em></p>`;
}

/** Replace `ac:structured-macro` blocks with HTML Turndown can turn into Markdown (e.g. `code`, `panel`, `jira`). */
function replaceConfluenceStructuredMacros(html: string): string {
  let prev = '';
  let out = html;

  for (let guard = 0; guard < 100 && prev !== out; guard++) {
    prev = out;
    out = out.replace(STRUCTURED_MACRO_INNERMOST, (full, inner: string) => replaceOneStructuredMacro(full, inner));
  }

  return out;
}

function stripResidualConfluenceMarkup(html: string): string {
  return html
    .replace(/<ac:task-list[\s\S]*?<\/ac:task-list>/gi, '\n')
    .replace(/<ac:task-list[^>]*\/>/gi, '\n')
    .replace(/<ac:adf-extension[\s\S]*?<\/ac:adf-extension>/gi, '\n')
    .replace(/<ac:adf-extension[^>]*\/>/gi, '\n')
    .replace(/<\/?ac:[^>]+>/gi, '')
    .replace(/<ri:[^>]+\/>/gi, '')
    .replace(/<ri:[^>]+>/gi, '')
    .replace(/<\/ri:[^>]+>/gi, '');
}

/** Editor-only attributes; removing them keeps Turndown output stable. */
function stripEditorNoiseAttributes(html: string): string {
  return html
    .replace(/\s+local-id="[^"]*"/gi, '')
    .replace(/\s+ac:local-id="[^"]*"/gi, '')
    .replace(/\s+ac:card-appearance="[^"]*"/gi, '')
    .replace(/\s+ac:schema-version="[^"]*"/gi, '')
    .replace(/\s+ac:macro-id="[^"]*"/gi, '')
    .replace(/\s+ri:version-at-save="[^"]*"/gi, '');
}

/** Confluence `<p … />` self-closers are not valid for all parsers; normalize to nothing. */
function normalizeSelfClosingParagraphs(html: string): string {
  return html.replace(/<p\b[^>]*\/\s*>/gi, '\n');
}

/**
 * Turndown's paragraph rule wraps cell text in `\n\n`, which breaks GFM pipe rows. Confluence
 * almost always uses `<p>` inside `<th>`/`<td>`; unwrap to inline cell content first.
 */
function flattenCellInnerHtml(inner: string): string {
  let s = inner;
  let prev = '';
  let guard = 0;

  while (prev !== s && guard++ < 50) {
    prev = s;
    s = s.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, '$1 ');
  }

  return s.trim();
}

function unwrapParagraphsInTableCells(html: string): string {
  return html.replace(
    /<(th|td)\b([^>]*)>([\s\S]*?)<\/(th|td)>/gi,
    (full, t1: string, attrs: string, inner: string, t2: string) => {
      if (t1.toLowerCase() !== t2.toLowerCase()) {
        return full;
      }

      return `<${t1}${attrs}>${flattenCellInnerHtml(inner)}</${t1}>`;
    },
  );
}

/**
 * Confluence wraps each `<li>` body in `<p>…</p>`. Turndown then inserts blank lines between
 * list items. Only unwrap when `</p>` is immediately followed by `</li>`.
 */
function unwrapConfluenceListItemParagraphs(html: string): string {
  let prev = '';
  let out = html;
  let guard = 0;

  while (prev !== out && guard++ < 500) {
    prev = out;
    out = out.replace(/<li([^>]*)>\s*<p\b[^>]*>([\s\S]*?)<\/p>\s*<\/li>/gi, '<li$1>$2</li>');
  }

  return out;
}

function normalizeTurndownMarkdownLists(md: string): string {
  let out = md.replace(/^(\s*)([*+-])(\s{2,})/gm, '$1$2 ');

  out = out.replace(/^(\s*)(\d+\.)(\s{2,})/gm, '$1$2 ');

  const lines = out.split('\n');
  const merged: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prev = merged[merged.length - 1];
    const prevIsList = prev !== undefined && /^\s*(?:[-*+]|\d+\.)\s/.test(prev);

    if (line.trim() === '' && prevIsList && i + 1 < lines.length && /^\s*(?:[-*+]|\d+\.)\s/.test(lines[i + 1])) {
      continue;
    }

    merged.push(line);
  }

  return merged.join('\n');
}

let turndown: TurndownService | null = null;

function getTurndown(): TurndownService {
  if (!turndown) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const TurndownCtor = require('turndown') as new (options?: {
      headingStyle?: 'setext' | 'atx';
      codeBlockStyle?: 'indented' | 'fenced';
      bulletListMarker?: '-' | '+' | '*';
      emDelimiter?: '_' | '*';
      preformattedCode?: boolean;
    }) => TurndownService;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const tables = require('turndown-plugin-gfm').tables as (svc: TurndownService) => void;
    const svc = new TurndownCtor({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
      emDelimiter: '*',
      preformattedCode: true,
    });

    svc.use(tables);
    turndown = svc;
  }

  return turndown;
}

function preprocessConfluenceStorageHtml(html: string): string {
  let s = html;

  s = replaceConfluenceAcLinks(s);
  s = replaceConfluenceStructuredMacros(s);
  s = stripResidualConfluenceMarkup(s);
  s = stripEditorNoiseAttributes(s);
  s = normalizeSelfClosingParagraphs(s);
  s = unwrapConfluenceListItemParagraphs(s);
  s = unwrapParagraphsInTableCells(s);
  s = insertNewlinesBeforeBlockOpens(s);

  return s;
}

/**
 * Converts a Confluence `body.storage` / editor HTML fragment to Markdown.
 */
export function confluenceStorageHtmlToMarkdown(html: string): string {
  if (!html?.trim()) {
    return '';
  }

  const cleaned = preprocessConfluenceStorageHtml(html);
  const wrapped = cleaned.includes('<') ? `<div>${cleaned}</div>` : cleaned;

  try {
    const md = getTurndown().turndown(wrapped).trim();

    return decodeBasicEntities(normalizeTurndownMarkdownLists(md))
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  } catch {
    return confluenceStorageHtmlToPlainFallback(cleaned);
  }
}
