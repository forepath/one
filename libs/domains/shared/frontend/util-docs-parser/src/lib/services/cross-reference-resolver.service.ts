import { Injectable } from '@angular/core';

/**
 * Service for resolving cross-references in markdown content
 */
@Injectable({
  providedIn: 'root',
})
export class CrossReferenceResolverService {
  /**
   * Resolve cross-references in markdown content
   * Converts relative markdown links to Angular router links
   */
  resolveCrossReferences(content: string, basePath = '/docs'): string {
    // Pattern: [Link Text](./relative/path.md) or [Link Text](../../libs/...)
    const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;

    return content.replace(linkPattern, (match, linkText, linkPath) => {
      // Skip external links (http://, https://, mailto:, etc.)
      if (/^(https?|mailto|ftp):/i.test(linkPath)) {
        return match; // Keep original external link
      }

      // Skip anchor-only links (#section)
      if (linkPath.startsWith('#')) {
        return match; // Keep anchor link
      }

      // Resolve relative paths
      const resolvedPath = this.resolvePath(linkPath, basePath);

      // Convert to Angular router link format
      // For now, we'll keep the markdown format and handle conversion in the component
      // This allows us to preserve the link structure
      return `[${linkText}](${resolvedPath})`;
    });
  }

  /**
   * Resolve a relative path to an absolute route path
   */
  private resolvePath(linkPath: string, basePath: string): string {
    // Remove .md extension
    let path = linkPath.replace(/\.md$/, '').replace(/\.md#/, '#');

    // Handle relative paths
    if (path.startsWith('./')) {
      path = path.substring(2);
    } else if (path.startsWith('../')) {
      // Handle parent directory references
      // For now, keep as-is and handle in component
    } else if (!path.startsWith('/')) {
      // Relative path without ./
    }

    // Handle README files
    if (path.endsWith('/README') || path.endsWith('/readme')) {
      path = path.replace(/\/README$/, '').replace(/\/readme$/, '');
    }

    // Build full path
    if (path.startsWith('/docs/') || path.startsWith('/libs/') || path.startsWith('/apps/')) {
      // Already absolute path
      return path;
    }

    // Relative to base path
    if (basePath.endsWith('/')) {
      return `${basePath}${path}`;
    }

    return `${basePath}/${path}`;
  }

  /**
   * Validate that a link target exists
   * This would be used at build time to check for broken links
   */
  validateLink(linkPath: string, availableFiles: string[]): boolean {
    // Remove anchor
    const pathWithoutAnchor = linkPath.split('#')[0];

    // Check if file exists in available files
    return availableFiles.some((file) => {
      const filePath = file.replace(/\.md$/, '');

      return filePath === pathWithoutAnchor || filePath.endsWith(`/${pathWithoutAnchor}`);
    });
  }
}
