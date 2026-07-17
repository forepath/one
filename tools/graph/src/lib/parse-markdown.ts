import * as fs from 'fs';
import * as path from 'path';

import { conceptNodeId, fileNodeId, KnowledgeEdge, KnowledgeNode, slugify } from './schema';

export interface ParsedHeading {
  level: number;
  title: string;
  anchor: string;
  /** Text from this heading until the next H1/H2 (exclusive). */
  sectionText: string;
}

export interface ParseMarkdownResult {
  headings: ParsedHeading[];
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  /** Map concept id → section-local text for documents linking */
  conceptTexts: Map<string, string>;
}

const HEADING_LINE_RE = /^(#{1,2})\s+(.+)$/;

/**
 * Parse Markdown H1/H2 headings into concept nodes.
 */
export function parseMarkdown(relativePath: string, content: string): ParseMarkdownResult {
  const nodes: KnowledgeNode[] = [];
  const edges: KnowledgeEdge[] = [];
  const headings: ParsedHeading[] = [];
  const conceptTexts = new Map<string, string>();
  const fileId = fileNodeId(relativePath);

  const parts = relativePath.replace(/\\/g, '/').split('/');
  const domain = parts[0] === 'docs' && parts.length > 1 ? parts[1] : undefined;

  const lines = content.split(/\r?\n/);
  const headingIndices: Array<{ index: number; level: number; title: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    const match = HEADING_LINE_RE.exec(lines[i]);
    if (!match) {
      continue;
    }
    const title = match[2]
      .trim()
      .replace(/#+\s*$/, '')
      .trim();
    if (!title) {
      continue;
    }
    headingIndices.push({ index: i, level: match[1].length, title });
  }

  for (let h = 0; h < headingIndices.length; h++) {
    const current = headingIndices[h];
    const nextIndex = h + 1 < headingIndices.length ? headingIndices[h + 1].index : lines.length;
    const sectionLines = lines.slice(current.index, nextIndex);
    const sectionText = sectionLines.join('\n');
    const anchor = slugify(current.title);
    const slugBase = domain ? `${domain}-${anchor}` : anchor;
    const conceptId = conceptNodeId(slugBase);

    headings.push({
      level: current.level,
      title: current.title,
      anchor,
      sectionText,
    });
    nodes.push({
      id: conceptId,
      type: 'concept',
      attrs: {
        title: current.title,
        docPath: relativePath,
        sectionAnchor: anchor,
        domain,
      },
    });
    edges.push({ from: fileId, to: conceptId, type: 'contains' });
    conceptTexts.set(conceptId, sectionText);
  }

  return {
    headings,
    nodes,
    edges,
    conceptTexts,
  };
}

export function parseMarkdownFile(relativePath: string, absolutePath: string): ParseMarkdownResult {
  const content = fs.readFileSync(absolutePath, 'utf8');
  return parseMarkdown(relativePath, content);
}

export function docsDomainFromPath(relativePath: string): string | undefined {
  const normalized = relativePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  if (parts[0] === 'docs' && parts.length > 1) {
    return parts[1];
  }
  return undefined;
}

export function resolveDocAbsolute(workspaceRoot: string, relativePath: string): string {
  return path.join(workspaceRoot, relativePath);
}
