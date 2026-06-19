/**
 * Confluence REST returns ancestors from immediate parent toward the space root.
 * Import logic needs root → immediate parent for folder creation.
 */
export function confluenceAncestorsRootToParent<T extends { id?: string }>(ancestors: readonly T[] | undefined): T[] {
  if (!ancestors?.length) {
    return [];
  }

  return [...ancestors].reverse();
}

/**
 * Slice ancestor chain to only nodes strictly below the configured root page (exclusive).
 */
export function sliceAncestorsBelowRoot<T extends { id?: string }>(
  rootToParent: readonly T[],
  rootPageId: string | null | undefined,
): T[] {
  if (!rootPageId) {
    return [...rootToParent];
  }

  const idx = rootToParent.findIndex((a) => a.id === rootPageId);

  if (idx < 0) {
    return [...rootToParent];
  }

  return rootToParent.slice(idx + 1);
}

/** Root → immediate parent chain for import, after optional root-page slice. */
export function confluenceAncestorChainForImport<T extends { id?: string }>(
  ancestors: readonly T[] | undefined,
  rootPageId: string | null | undefined,
): T[] {
  return sliceAncestorsBelowRoot(confluenceAncestorsRootToParent(ancestors), rootPageId);
}

/**
 * When the API batch returns a single page, drop the shallowest ancestor (index 0
 * in root→parent order) so the space home (or similar top anchor) is not materialized
 * as a folder for a lone leaf page.
 */
export function trimShallowestConfluenceAncestorForSingleResultBatch<T>(
  filteredResultCount: number,
  chain: readonly T[],
): T[] {
  if (filteredResultCount !== 1 || chain.length === 0) {
    return [...chain];
  }

  return chain.slice(1);
}

export function isConfluencePageTypeAncestor<T extends { type?: string }>(node: T): boolean {
  return String(node.type ?? 'page').toLowerCase() === 'page';
}

/** Page-type Confluence ids that need a folder + inner page shell (have an imported descendant page). */
export function confluencePageIdsNeedingParentPageShellFolder<
  T extends { id?: string; type?: string; ancestors?: readonly { id?: string; type?: string }[] },
>(pages: readonly T[], rootPageId: string | null | undefined): Set<string> {
  const need = new Set<string>();
  const n = pages.length;

  for (const p of pages) {
    const ch = trimShallowestConfluenceAncestorForSingleResultBatch(
      n,
      confluenceAncestorChainForImport(p.ancestors, rootPageId),
    );

    for (const a of ch) {
      if (isConfluencePageTypeAncestor(a) && a.id) {
        need.add(a.id);
      }
    }
  }

  return need;
}

/** True if this page is a strict page-ancestor of another item in the same import batch. */
export function confluencePageNeedsShellFolderForImportedSubtree<
  T extends { id?: string; ancestors?: readonly { id?: string; type?: string }[] },
>(page: T, batchPages: readonly T[], rootPageId: string | null | undefined): boolean {
  const n = batchPages.length;

  return batchPages.some((q) => {
    if (!page.id || q.id === page.id) {
      return false;
    }

    const ch = trimShallowestConfluenceAncestorForSingleResultBatch(
      n,
      confluenceAncestorChainForImport(q.ancestors, rootPageId),
    );

    return ch.some((a) => isConfluencePageTypeAncestor(a) && a.id === page.id);
  });
}

/**
 * Raw Confluence page body: prefers `body.storage.value`, falls back to `body.view.value`.
 * Import converts storage HTML to Markdown using `confluenceStorageHtmlToMarkdown`.
 */
export function confluencePageBodyHtml(page: {
  body?: { storage?: { value?: string }; view?: { value?: string } };
}): string {
  const storage = page.body?.storage?.value;
  const view = page.body?.view?.value;

  if (storage?.trim()) {
    return storage;
  }

  return view ?? '';
}

interface AdfMark {
  type: string;
  attrs?: Record<string, unknown>;
}

interface AdfNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
  marks?: AdfMark[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isJiraAdfDocument(value: unknown): value is AdfNode {
  return isRecord(value) && value.type === 'doc' && Array.isArray(value.content);
}

function applyMarks(text: string, marks?: AdfMark[]): string {
  if (!marks?.length) {
    return text;
  }

  let out = text;

  for (const mark of marks) {
    switch (mark.type) {
      case 'strong':
        out = `**${out}**`;
        break;
      case 'em':
        out = `*${out}*`;
        break;
      case 'strike':
        // Omit `~~`: easy to false-trigger GFM / task-list parsers on imported tickets.
        break;
      case 'code':
        out = `\`${out.replace(/`/g, '\\`')}\``;
        break;
      case 'underline':
        break;

      case 'link': {
        const href = String(mark.attrs?.href ?? '');

        if (href) {
          out = `[${out}](${href})`;
        }

        break;
      }

      default:
        break;
    }
  }

  return out;
}

function adfText(node: AdfNode): string {
  const raw = node.text ?? '';

  return applyMarks(raw, node.marks);
}

function adfBlock(
  nodes: AdfNode[] | undefined,
  depth: number,
  listStack: { ordered: boolean; index: number }[],
): string {
  if (!nodes?.length) {
    return '';
  }

  const parts: string[] = [];

  for (const node of nodes) {
    const piece = adfNodeToMarkdown(node, depth, listStack);

    if (piece) {
      parts.push(piece);
    }
  }

  return parts.join('');
}

function adfNodeToMarkdown(node: AdfNode, depth: number, listStack: { ordered: boolean; index: number }[]): string {
  switch (node.type) {
    case 'text':
      return adfText(node);
    case 'hardBreak':
      return '  \n';

    case 'emoji': {
      const s = String(node.attrs?.shortName ?? node.attrs?.id ?? '');

      return s ? `:${s.replace(/^:/, '').replace(/:$/, '')}:` : '';
    }

    case 'mention': {
      const label = String(node.attrs?.text ?? node.attrs?.id ?? '@mention');

      return label.startsWith('@') ? label : `@${label}`;
    }

    case 'date':
      return String(node.attrs?.timestamp ?? '');
    case 'status':
      return String(node.attrs?.text ?? '');

    case 'inlineCard': {
      const url = String(node.attrs?.url ?? '');

      return url ? `[${url}](${url})` : '';
    }

    case 'blockCard': {
      const url = String(node.attrs?.url ?? '');

      return url ? `[${url}](${url})\n\n` : '';
    }

    case 'paragraph':
      return `${adfBlock(node.content, depth, listStack).trim()}\n\n`;

    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level ?? 1)));
      const hashes = '#'.repeat(level);
      const inner = adfBlock(node.content, depth, listStack).trim();

      return inner ? `${hashes} ${inner}\n\n` : '';
    }

    case 'blockquote':
      return adfBlock(node.content, depth, listStack)
        .split('\n')
        .map((line) => (line.trim() ? `> ${line}` : '>'))
        .join('\n')
        .concat('\n\n');
    case 'rule':
      return '---\n\n';

    case 'bulletList':
      listStack.push({ ordered: false, index: 0 });

      try {
        return adfBlock(node.content, depth, listStack);
      } finally {
        listStack.pop();
      }

    case 'taskList':
      listStack.push({ ordered: false, index: 0 });

      try {
        return adfBlock(node.content, depth, listStack);
      } finally {
        listStack.pop();
      }

    case 'orderedList': {
      const start = Math.max(1, Number(node.attrs?.order ?? 1));

      listStack.push({ ordered: true, index: start });

      try {
        return adfBlock(node.content, depth, listStack);
      } finally {
        listStack.pop();
      }
    }

    case 'taskItem': {
      const indent = '  '.repeat(Math.max(0, listStack.length - 1));
      const raw = node.attrs?.state;
      const s = typeof raw === 'boolean' ? (raw ? 'DONE' : 'TODO') : String(raw ?? 'TODO').toUpperCase();
      const box = s === 'DONE' || s === 'TRUE' || s === 'CHECKED' ? '[x]' : '[ ]';
      const body = adfBlock(node.content, depth + 1, listStack)
        .trimEnd()
        .replace(/\s*\n\s*/g, ' ')
        .replace(/^\s+/, '');

      return `${indent}- ${box} ${body}\n`;
    }

    case 'listItem': {
      const parent = listStack[listStack.length - 1];
      const indent = '  '.repeat(Math.max(0, listStack.length - 1));
      const body = adfBlock(node.content, depth + 1, listStack).trimEnd();

      if (parent?.ordered) {
        const n = parent.index;

        parent.index += 1;

        return `${indent}${n}. ${body.replace(/^\s+/, '')}\n`;
      }

      return `${indent}- ${body.replace(/^\s+/, '')}\n`;
    }

    case 'codeBlock': {
      const lang = String(node.attrs?.language ?? '').trim();
      const fence = '```';
      const inner = adfBlock(node.content, depth, listStack).replace(/\n+$/, '');

      return `${fence}${lang}\n${inner}\n${fence}\n\n`;
    }

    case 'mediaGroup':
    case 'mediaSingle':
      return `${adfBlock(node.content, depth, listStack)}\n`;

    case 'media': {
      const alt = String(node.attrs?.alt ?? 'attachment');

      return `![${alt}](attachment)\n`;
    }

    case 'table': {
      const rows = node.content ?? [];
      const lines: string[] = [];

      for (const row of rows) {
        if (row.type !== 'tableRow') {
          continue;
        }

        const cells = (row.content ?? [])
          .filter((c) => c.type === 'tableCell' || c.type === 'tableHeader')
          .map((c) =>
            adfBlock(c.content, depth, listStack)
              .replace(/\s*\n\s*/g, ' ')
              .trim(),
          );

        if (cells.length) {
          lines.push(`| ${cells.join(' | ')} |`);
        }
      }

      if (lines.length === 0) {
        return '';
      }

      const inner = lines[0].replace(/^\|\s*/, '').replace(/\s*\|$/, '');
      const colCount = inner ? inner.split(/\s*\|\s*/).length : 0;
      const sep = `| ${Array.from({ length: colCount }, () => '---').join(' | ')} |`;

      return [lines[0], sep, ...lines.slice(1)].join('\n').concat('\n\n');
    }

    case 'tableRow':
    case 'tableCell':
    case 'tableHeader':
      return adfBlock(node.content, depth, listStack);
    case 'doc':
      return adfBlock(node.content, depth, listStack).trim();
    case 'panel':
    case 'expand':
    case 'nestedExpand':
      return adfBlock(node.content, depth, listStack);
    default:
      return adfBlock(node.content, depth, listStack);
  }
}

/**
 * Converts Jira / Confluence ADF JSON to Markdown for ticket descriptions.
 */
export function jiraAdfToMarkdown(doc: unknown): string {
  if (!isJiraAdfDocument(doc)) {
    return '';
  }

  return adfNodeToMarkdown(doc, 0, [])
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
