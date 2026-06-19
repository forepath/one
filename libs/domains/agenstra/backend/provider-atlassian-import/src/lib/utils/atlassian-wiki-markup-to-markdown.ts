/**
 * Converts legacy Atlassian wiki / Text Formatting Notation (Jira WikiRenderer,
 * Confluence wiki-style bodies) to Markdown. Behaviour follows Atlassian's public
 * WikiRenderer help (headings, text effects, breaks, links, lists, images, tables,
 * {code}/{noformat}/{quote}/{panel}/{color}, escapes).
 */

const PH_ESC_BRACE = '\uE000';
const PH_ESC_BACKSLASH = '\uE001';
const PH_HR = '\uE003';

function parseCodeMacroHeader(header: string): string {
  const h = header.trim().replace(/^:/, '');

  if (!h) {
    return '';
  }

  if (!h.includes('=') && !h.includes('|')) {
    return h;
  }

  const titleMatch = h.match(/title\s*=\s*([^|]+)/i);

  if (titleMatch) {
    const file = titleMatch[1].trim();
    const ext = file.match(/\.([A-Za-z0-9]+)\s*$/);

    if (ext) {
      return ext[1].toLowerCase();
    }
  }

  return '';
}

function fenceCode(lang: string, body: string): string {
  const inner = body.replace(/\r\n/g, '\n').replace(/\n+$/, '');
  const escaped = inner.replace(/```/g, '\\`\\`\\`');
  const fence = '```';

  return `${fence}${lang}\n${escaped}\n${fence}\n\n`;
}

function blockquoteFromPlainBody(body: string): string {
  const normalized = body.replace(/\r\n/g, '\n').trimEnd();

  return normalized
    .split('\n')
    .map((line) => (line.length ? `> ${line}` : '>'))
    .join('\n')
    .concat('\n\n');
}

function repeatMacroReplace(
  s: string,
  pattern: RegExp,
  replacer: (full: string, ...captures: string[]) => string,
): string {
  let result = s;
  let prev = '';
  let guard = 0;

  while (prev !== result && guard++ < 500) {
    prev = result;
    result = result.replace(pattern, (full: string, ...args: Array<string | number>) => {
      const captures = args.slice(0, -2) as string[];

      return replacer(full, ...captures);
    });
  }

  return result;
}

function protectEscapes(text: string): string {
  return text.replace(/\\([\\{])/g, (_, ch: string) => (ch === '{' ? PH_ESC_BRACE : PH_ESC_BACKSLASH));
}

function restoreEscapes(text: string): string {
  return text.replace(new RegExp(PH_ESC_BRACE, 'g'), '{').replace(new RegExp(PH_ESC_BACKSLASH, 'g'), '\\');
}

/** True when the string likely uses Jira/Confluence wiki renderer notation. */
export function looksLikeAtlassianWikiMarkup(text: string): boolean {
  const t = text.trim();

  if (!t) {
    return false;
  }

  if (/\{code\b/i.test(t)) {
    return true;
  }

  if (/\{noformat\b/i.test(t)) {
    return true;
  }

  if (/\{quote\b/i.test(t)) {
    return true;
  }

  if (/\{panel\b/i.test(t)) {
    return true;
  }

  if (/\{color(?::|\})/i.test(t)) {
    return true;
  }

  if (/\{anchor:/i.test(t)) {
    return true;
  }

  if (/^h[1-6]\.\s/m.test(t)) {
    return true;
  }

  if (/^bq\.\s/m.test(t)) {
    return true;
  }

  if (/\|\|[^|\n]+\|\|/.test(t)) {
    return true;
  }

  if (/\[~[^\]]+\]/.test(t)) {
    return true;
  }

  return false;
}

function wikiTableToMarkdown(block: string): string {
  const lines = block.split(/\r?\n/).map((l) => l.trimEnd());
  const rows: string[][] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    if (trimmed.startsWith('||') && trimmed.includes('||')) {
      const cells = trimmed
        .split('||')
        .map((c) => c.trim())
        .filter((c) => c.length > 0);

      if (cells.length) {
        rows.push(cells);
      }

      continue;
    }

    if (trimmed.startsWith('|') && trimmed.endsWith('|') && !trimmed.startsWith('||')) {
      const inner = trimmed.slice(1, -1);
      const cells = inner.split('|').map((c) => c.trim());

      if (cells.length) {
        rows.push(cells);
      }
    }
  }

  if (rows.length === 0) {
    return block;
  }

  const esc = (c: string) => c.replace(/\|/g, '\\|');
  const mdRows = rows.map((r) => `| ${r.map(esc).join(' | ')} |`);
  const colCount = rows[0].length;
  const sep = `| ${Array.from({ length: colCount }, () => '---').join(' | ')} |`;

  return [mdRows[0], sep, ...mdRows.slice(1)].join('\n').concat('\n\n');
}

function tryConvertWikiTableBlocks(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const trimmed = lines[i].trim();

    if (trimmed.startsWith('||') && trimmed.includes('||')) {
      const buf: string[] = [lines[i]];
      let j = i + 1;

      while (j < lines.length) {
        const ln = lines[j].trim();

        if (ln.startsWith('|') && ln.endsWith('|')) {
          buf.push(lines[j]);
          j += 1;
          continue;
        }

        break;
      }

      out.push(wikiTableToMarkdown(buf.join('\n')).trimEnd());
      i = j;

      continue;
    }

    out.push(lines[i]);
    i += 1;
  }

  return out.join('\n');
}

function wikiLinksAndImages(s: string): string {
  let t = s;

  t = t.replace(/!([^!\n|]+)(?:\|([^!]*))?!/g, (_, src: string) => {
    const url = src.trim();

    return url ? `![${url}](${url})` : '';
  });

  t = t.replace(/\[~([^\]]+)\]/g, '@$1');

  t = t.replace(/\[([^\]]+)\]/g, (full, inner: string) => {
    if (!inner.includes('|')) {
      const x = inner.trim();

      if (/^(https?:\/\/|mailto:)/i.test(x)) {
        return `[${x}](${x})`;
      }

      if (x.startsWith('#')) {
        return `[${x}](${x})`;
      }

      if (x.startsWith('^')) {
        return `[attachment: ${x.slice(1)}](${x.slice(1)})`;
      }

      return full;
    }

    const pipe = inner.indexOf('|');
    const label = inner.slice(0, pipe).trim();
    const href = inner.slice(pipe + 1).trim();

    return href ? `[${label}](${href})` : full;
  });

  return t;
}

function wikiInlineEffectsOnContent(t: string): string {
  let out = t;

  out = out.replace(/\{\{([^}]+)\}\}/g, (_, inner: string) => `\`${inner.replace(/`/g, '\\`')}\``);
  out = out.replace(/\*\*([^*]+)\*\*/g, '§DBLSTAR§$1§DBLSTAR§');
  out = out.replace(/\*([^*\n]+)\*/g, '**$1**');
  out = out.replace(/§DBLSTAR§/g, '**');
  out = out.replace(/_([^_\n]+)_/g, '*$1*');
  out = out.replace(/\?\?([^?\n]+)\?\?/g, '*$1*');
  // Wiki `-deleted-` is not mapped to `~~`: hyphenated words, ranges, and task lines false-positive GFM.
  out = out.replace(/\+([^+\n]+)\+/g, '**$1**');
  out = out.replace(/\^([^^\n]+)\^/g, '^$1^');
  out = out.replace(/~([^~\n]+)~/g, '~$1~');

  return out;
}

function wikiInlineEffectsOnLine(line: string): string {
  return wikiInlineEffectsOnContent(line);
}

function wikiInlineEffects(s: string): string {
  return s
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();

      if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
        return line;
      }

      return wikiInlineEffectsOnLine(line);
    })
    .join('\n');
}

function wikiListLines(s: string): string {
  const lines = s.split(/\r?\n/);
  const out: string[] = [];

  for (const line of lines) {
    const m = line.match(/^(\s*)(\*+|#+|-)\s+(.*)$/);

    if (m) {
      const indentUnit = '  ';
      const sym = m[2];
      const rest = m[3];
      const baseIndent = m[1];

      if (sym === '-') {
        out.push(`${baseIndent}- ${rest}`);

        continue;
      }

      if (sym.startsWith('*')) {
        const depth = sym.length;

        out.push(`${baseIndent}${indentUnit.repeat(Math.max(0, depth - 1))}- ${rest}`);

        continue;
      }

      if (sym.startsWith('#')) {
        const depth = sym.length;

        out.push(`${baseIndent}${indentUnit.repeat(Math.max(0, depth - 1))}1. ${rest}`);

        continue;
      }
    }

    out.push(line);
  }

  return out.join('\n');
}

function wikiHeadingsAndBlockLineMarkers(s: string): string {
  const lines = s.split(/\r?\n/);
  const out: string[] = [];

  for (const line of lines) {
    const hm = line.match(/^(h([1-6]))\.\s+(.*)$/i);

    if (hm) {
      const level = Math.min(6, Math.max(1, Number(hm[2])));
      const hashes = '#'.repeat(level);

      out.push(`${hashes} ${hm[3].trim()}`);

      continue;
    }

    const bq = line.match(/^bq\.\s+(.*)$/i);

    if (bq) {
      out.push(`> ${bq[1].trim()}`);

      continue;
    }

    out.push(line);
  }

  return out.join('\n');
}

function wikiTextBreaks(s: string): string {
  let t = s.replace(/(^|\n)----\s*(?=\n|$)/g, `$1${PH_HR}\n`);

  t = t.replace(/(^|\n)---(?![-\n])/g, '$1—');
  t = t.replace(/(^|\n)--(?![-\n])/g, '$1–');
  t = t.replace(/\\\\/g, '  \n');
  t = t.replace(new RegExp(PH_HR, 'g'), '\n---\n');

  return t;
}

/**
 * Converts Atlassian wiki markup to Markdown. Prefer calling when
 * {@link looksLikeAtlassianWikiMarkup} is true.
 */
export function atlassianWikiMarkupToMarkdown(raw: string): string {
  let s = raw.replace(/\r\n/g, '\n');

  s = protectEscapes(s);

  s = repeatMacroReplace(s, /\{code([^}]*)\}([\s\S]*?)\{code\}/gi, (_full, h, body) => {
    const lang = parseCodeMacroHeader(h ?? '');

    return fenceCode(lang, body ?? '');
  });

  s = repeatMacroReplace(s, /\{noformat\}([\s\S]*?)\{noformat\}/gi, (_full, body) => fenceCode('', body ?? ''));

  s = repeatMacroReplace(s, /\{quote\}([\s\S]*?)\{quote\}/gi, (_full, body) => {
    const innerMd = atlassianWikiMarkupToMarkdown(body ?? '');

    return blockquoteFromPlainBody(innerMd.trim());
  });

  s = repeatMacroReplace(s, /\{panel([^}]*)\}([\s\S]*?)\{panel\}/gi, (_full, header, body) => {
    const h = header ?? '';
    const b = body ?? '';
    const titleMatch = h.match(/title\s*=\s*([^|]+)/i);
    const title = titleMatch ? titleMatch[1].trim() : '';
    const innerMd = atlassianWikiMarkupToMarkdown(b).trimEnd();

    if (title) {
      const quoted = innerMd
        .split('\n')
        .map((ln) => (ln.length ? `> ${ln}` : '>'))
        .join('\n');

      return `> **${title}**\n>\n${quoted}\n\n`;
    }

    return blockquoteFromPlainBody(innerMd);
  });

  s = repeatMacroReplace(
    s,
    /\{color:[^}]+\}([\s\S]*?)\{color\}/gi,
    (_full, inner) => `${atlassianWikiMarkupToMarkdown(inner ?? '').trimEnd()}\n\n`,
  );

  s = s.replace(/\{anchor:[^}]+\}/gi, '');
  s = tryConvertWikiTableBlocks(s);
  s = wikiListLines(s);
  s = wikiHeadingsAndBlockLineMarkers(s);
  s = wikiTextBreaks(s);
  s = wikiLinksAndImages(s);
  s = wikiInlineEffects(s);
  s = restoreEscapes(s);

  return s.replace(/\n{3,}/g, '\n\n').trim();
}
