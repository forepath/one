import { Injectable } from '@angular/core';

import { DocMetadata, SearchIndex, SearchIndexEntry } from '../interfaces';

/**
 * Service for building search index from documentation metadata
 */
@Injectable({
  providedIn: 'root',
})
export class SearchIndexBuilderService {
  /**
   * Build search index from documentation metadata
   */
  buildSearchIndex(metadata: DocMetadata[]): SearchIndex {
    const entries: SearchIndexEntry[] = metadata.map((doc) => ({
      path: this.metadataToPath(doc.path),
      title: doc.title,
      summary: doc.summary,
      content: this.extractSearchableContent(doc),
      headings: doc.headings.map((h) => h.text),
    }));

    return { entries };
  }

  /**
   * Convert metadata path to route path
   */
  private metadataToPath(filePath: string): string {
    const pathWithoutExt = filePath.replace(/\.md$/, '');
    const isReadme = filePath.toLowerCase().endsWith('readme.md');

    if (isReadme) {
      // For README files, use the directory path
      const parts = pathWithoutExt.split('/');

      parts.pop(); // Remove 'README'
      const dirPath = parts.join('/');

      return dirPath ? `/docs/${dirPath}` : '/docs';
    }

    return `/docs/${pathWithoutExt}`;
  }

  /**
   * Extract searchable content from metadata
   * Removes markdown syntax and HTML tags for better search
   */
  private extractSearchableContent(metadata: DocMetadata): string {
    // Use raw markdown content, remove code blocks and their content
    let content = metadata.content;

    // Remove code blocks (including mermaid)
    content = content.replace(/```[\s\S]*?```/g, '');

    // Remove inline code
    content = content.replace(/`[^`]+`/g, '');

    // Remove markdown links but keep text
    content = content.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

    // Remove images
    content = content.replace(/!\[([^\]]*)\]\([^)]+\)/g, '');

    // Remove headings markers
    content = content.replace(/^#+\s+/gm, '');

    // Remove frontmatter
    content = content.replace(/^---[\s\S]*?---\s*/m, '');

    // Remove extra whitespace
    content = content.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();

    return content;
  }
}
