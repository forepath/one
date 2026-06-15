import { Injectable } from '@angular/core';
import { marked } from 'marked';

import { DocHeading, DocMetadata } from '../interfaces';

/**
 * Service for parsing markdown files and extracting metadata
 */
@Injectable({
  providedIn: 'root',
})
export class MarkdownParserService {
  private markedInstance: typeof marked | null = null;

  /**
   * Initialize marked parser
   */
  private async initMarked(): Promise<typeof marked> {
    if (this.markedInstance) {
      return this.markedInstance;
    }

    // Dynamic import for marked
    const markedModule = await import('marked');

    this.markedInstance = markedModule.marked;

    // Configure marked with GitHub Flavored Markdown
    this.markedInstance.setOptions({
      breaks: true,
      gfm: true,
    });

    return this.markedInstance;
  }

  /**
   * Parse markdown content and extract metadata
   */
  async parseMarkdown(content: string, filePath: string): Promise<DocMetadata> {
    const marked = await this.initMarked();
    // Extract title from first H1 heading
    const titleMatch = content.match(/^#\s+(.+)$/m);
    const title = titleMatch?.[1]?.trim() || this.extractTitleFromPath(filePath);
    // Extract summary from first paragraph (after frontmatter if present)
    const summary = this.extractSummary(content);
    // Extract headings
    const headings = this.extractHeadings(content);
    // Parse markdown to HTML
    const html = marked.parse(content) as string;

    return {
      path: filePath,
      title,
      summary,
      headings,
      content,
      html,
    };
  }

  /**
   * Extract title from file path if no H1 heading found
   */
  private extractTitleFromPath(filePath: string): string {
    const fileName = filePath.split('/').pop() || filePath;
    const nameWithoutExt = fileName.replace(/\.md$/, '');

    // Convert kebab-case or snake_case to Title Case
    return nameWithoutExt
      .split(/[-_]/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Extract summary from first paragraph
   */
  private extractSummary(content: string): string {
    // Remove frontmatter if present
    const withoutFrontmatter = content.replace(/^---[\s\S]*?---\s*/m, '');
    // Find first paragraph (non-empty line that's not a heading)
    const lines = withoutFrontmatter.split(/\n\n+/).map((s) => s.trim());
    const firstPara = lines.find((p) => p && !p.startsWith('#') && p.length > 20);

    if (firstPara) {
      // Remove markdown formatting and limit length
      return firstPara
        .replace(/[#*_`[\]]/g, '')
        .replace(/\n/g, ' ')
        .trim()
        .substring(0, 200);
    }

    return '';
  }

  /**
   * Extract all headings from markdown content
   */
  private extractHeadings(content: string): DocHeading[] {
    const headings: DocHeading[] = [];
    const lines = content.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Match headings (H1-H6)
      const h1Match = line.match(/^#\s+(.+)/);
      const h2Match = line.match(/^##\s+(.+)/);
      const h3Match = line.match(/^###\s+(.+)/);
      const h4Match = line.match(/^####\s+(.+)/);
      const h5Match = line.match(/^#####\s+(.+)/);
      const h6Match = line.match(/^######\s+(.+)/);
      let level: number | null = null;
      let text: string | null = null;

      if (h1Match) {
        level = 1;
        text = h1Match[1].trim();
      } else if (h2Match) {
        level = 2;
        text = h2Match[1].trim();
      } else if (h3Match) {
        level = 3;
        text = h3Match[1].trim();
      } else if (h4Match) {
        level = 4;
        text = h4Match[1].trim();
      } else if (h5Match) {
        level = 5;
        text = h5Match[1].trim();
      } else if (h6Match) {
        level = 6;
        text = h6Match[1].trim();
      }

      if (level && text) {
        // Strip markdown link syntax from heading text
        // Convert [text](url) to just "text"
        text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

        headings.push({
          level,
          text,
          id: this.generateHeadingId(text),
          lineNumber: i + 1,
        });
      }
    }

    return headings;
  }

  /**
   * Generate a URL-friendly ID from heading text
   */
  private generateHeadingId(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '') // Remove special characters
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-') // Replace multiple hyphens with single
      .trim();
  }

  /**
   * Check if content contains Mermaid diagrams
   */
  hasMermaidDiagram(content: string): boolean {
    return /```mermaid[\s\S]*?```/i.test(content);
  }

  /**
   * Extract Mermaid diagram code from content
   */
  extractMermaidDiagrams(content: string): string[] {
    const diagrams: string[] = [];
    const mermaidRegex = /```mermaid\s*([\s\S]*?)```/gi;
    let match;

    while ((match = mermaidRegex.exec(content)) !== null) {
      diagrams.push(match[1].trim());
    }

    return diagrams;
  }
}
