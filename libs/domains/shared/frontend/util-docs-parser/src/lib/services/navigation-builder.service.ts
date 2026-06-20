import { Injectable } from '@angular/core';

import { NavigationNode } from '../interfaces';

/**
 * Service for building navigation tree from file structure
 */
@Injectable({
  providedIn: 'root',
})
export class NavigationBuilderService {
  /**
   * Build navigation tree from file list
   * Files should be relative paths from docs root (e.g., 'agenstra/getting-started.md')
   */
  buildNavigationTree(files: string[], basePath = '/docs'): NavigationNode[] {
    const tree: NavigationNode[] = [];
    const nodeMap = new Map<string, NavigationNode>();
    // Sort files to ensure consistent ordering
    const sortedFiles = [...files].sort();

    for (const file of sortedFiles) {
      const parts = file.split('/');
      const fileName = parts[parts.length - 1];
      const isReadme = fileName.toLowerCase() === 'readme.md';
      // Build path segments
      const pathSegments = parts.slice(0, -1);
      const routePath = this.buildRoutePath(basePath, file, isReadme);
      // Create or get parent node
      let parent: NavigationNode[] = tree;
      let currentPath = '';

      for (let i = 0; i < pathSegments.length; i++) {
        const segment = pathSegments[i];

        currentPath = currentPath ? `${currentPath}/${segment}` : segment;

        let folderNode = nodeMap.get(currentPath);

        if (!folderNode) {
          const folderRoutePath = this.buildRoutePath(basePath, `${currentPath}/README.md`, true);

          folderNode = {
            title: this.formatTitle(segment),
            path: folderRoutePath,
            file: `${currentPath}/README.md`,
            children: [],
          };
          nodeMap.set(currentPath, folderNode);
          parent.push(folderNode);
        }

        parent = folderNode.children || [];
      }

      // Add file node
      const fileTitle = isReadme
        ? this.formatTitle(pathSegments[pathSegments.length - 1] || 'Documentation')
        : this.formatTitle(fileName.replace(/\.md$/, ''));
      const fileNode: NavigationNode = {
        title: fileTitle,
        path: routePath,
        file: file,
      };

      // If it's a README in a folder, it's the folder's main page
      if (isReadme && pathSegments.length > 0) {
        const folderPath = pathSegments.join('/');
        const folderNode = nodeMap.get(folderPath);

        if (folderNode) {
          // Update folder node with README info
          folderNode.file = file;
          folderNode.path = routePath;
        }
      } else {
        // Add as child of parent folder
        const parentPath = pathSegments.join('/');

        if (parentPath && nodeMap.has(parentPath)) {
          const parentNode = nodeMap.get(parentPath)!;

          if (!parentNode.children) {
            parentNode.children = [];
          }

          parentNode.children.push(fileNode);
        } else {
          // Root level file
          tree.push(fileNode);
        }
      }
    }

    // Sort nodes: READMEs first, then alphabetical
    this.sortNavigationNodes(tree);

    return tree;
  }

  /**
   * Build route path from file path
   */
  private buildRoutePath(basePath: string, file: string, isReadme: boolean): string {
    const pathWithoutExt = file.replace(/\.md$/, '');

    if (isReadme) {
      // For README files, use the directory path
      const parts = pathWithoutExt.split('/');

      parts.pop(); // Remove 'README'
      const dirPath = parts.join('/');

      return dirPath ? `${basePath}/${dirPath}` : basePath;
    }

    return `${basePath}/${pathWithoutExt}`;
  }

  /**
   * Format title from file/folder name
   */
  private formatTitle(name: string): string {
    return name
      .split(/[-_]/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Sort navigation nodes recursively
   */
  private sortNavigationNodes(nodes: NavigationNode[]): void {
    nodes.sort((a, b) => {
      // README files come first
      const aIsReadme = a.file.toLowerCase().endsWith('readme.md');
      const bIsReadme = b.file.toLowerCase().endsWith('readme.md');

      if (aIsReadme && !bIsReadme) return -1;

      if (!aIsReadme && bIsReadme) return 1;

      // Then by title
      return a.title.localeCompare(b.title);
    });

    // Sort children recursively
    for (const node of nodes) {
      if (node.children) {
        this.sortNavigationNodes(node.children);
      }
    }
  }
}
