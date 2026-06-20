import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { NavigationNode } from '@forepath/shared/frontend/util-docs-parser';
import { catchError, map, Observable, of, shareReplay } from 'rxjs';

/**
 * Service for managing navigation state
 */
@Injectable({
  providedIn: 'root',
})
export class DocsNavigationService {
  private readonly http = inject(HttpClient);

  private navigationCache: Observable<NavigationNode[]> | null = null;

  /**
   * Current active page path
   */
  readonly activePath = signal<string | null>(null);

  /**
   * Load navigation tree
   */
  loadNavigation(): Observable<NavigationNode[]> {
    if (this.navigationCache) {
      return this.navigationCache;
    }

    this.navigationCache = this.http.get<{ sections: NavigationNode[] }>('/assets/docs/navigation.json').pipe(
      map((data) => data.sections || []),
      catchError((error) => {
        console.error('Failed to load navigation', error);

        return of([]);
      }),
      shareReplay(1),
    );

    return this.navigationCache;
  }

  /**
   * Set active page path
   */
  setActivePath(path: string | null): void {
    this.activePath.set(path);
  }

  /**
   * Find navigation node by path
   */
  findNodeByPath(nodes: NavigationNode[], path: string): NavigationNode | null {
    for (const node of nodes) {
      if (node.path === path) {
        return node;
      }

      if (node.children) {
        const found = this.findNodeByPath(node.children, path);

        if (found) {
          return found;
        }
      }
    }

    return null;
  }

  /**
   * Get breadcrumb path for a given route
   */
  getBreadcrumbs(nodes: NavigationNode[], path: string): NavigationNode[] {
    const breadcrumbs: NavigationNode[] = [];
    const findPath = (nodeList: NavigationNode[], currentPath: string): boolean => {
      for (const node of nodeList) {
        if (node.path === currentPath) {
          breadcrumbs.push(node);

          return true;
        }

        if (node.children) {
          if (findPath(node.children, currentPath)) {
            breadcrumbs.unshift(node);

            return true;
          }
        }
      }

      return false;
    };

    findPath(nodes, path);

    return breadcrumbs;
  }
}
