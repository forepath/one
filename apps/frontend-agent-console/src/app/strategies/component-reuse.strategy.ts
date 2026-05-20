import { ActivatedRouteSnapshot, DetachedRouteHandle, RouteReuseStrategy } from '@angular/router';

/**
 * Custom RouteReuseStrategy that reuses component instances when navigating
 * between routes that use the same component.
 *
 * Applies when the route path ends with /editor, or when navigating between the
 * clients shell routes (workspaces → environments → chat). Editor/config/deployments
 * panels use the editor or default rules. Otherwise defaults to
 * Angular's default strategy (no reuse, standard route config matching).
 */
export class ComponentReuseStrategy implements RouteReuseStrategy {
  private storedRoutes = new Map<string, DetachedRouteHandle>();

  /**
   * Returns true when the route is a leaf under the `clients` parent with a component.
   */
  private isUnderClientsRoute(route: ActivatedRouteSnapshot): boolean {
    return route.pathFromRoot.some((segment) => segment.routeConfig?.path === 'clients');
  }

  /**
   * Main clients shell routes (workspaces list → workspace → environment/chat).
   * Excludes editor/config/deployments so those keep distinct route-config semantics.
   */
  private isClientsShellRoute(route: ActivatedRouteSnapshot): boolean {
    if (!route.component || !this.isUnderClientsRoute(route)) {
      return false;
    }

    const path = route.routeConfig?.path ?? '';

    return path === '' || path === ':clientId' || path === ':clientId/agents/:agentId';
  }

  /**
   * Returns true if the route path ends with /editor, meaning the custom reuse strategy applies.
   */
  private isEditorRoute(route: ActivatedRouteSnapshot): boolean {
    const path = route.pathFromRoot
      .flatMap((r) => r.url.map((s) => s.path))
      .filter(Boolean)
      .join('/');

    return path === 'editor' || path.endsWith('/editor');
  }

  /**
   * Determines if a route should be stored for potential reuse.
   * Returns true only for editor routes with a component.
   */
  shouldDetach(route: ActivatedRouteSnapshot): boolean {
    return this.isEditorRoute(route) && !!route.component;
  }

  /**
   * Stores the detached route handle for potential reuse.
   */
  store(route: ActivatedRouteSnapshot, handle: DetachedRouteHandle | null): void {
    if (handle) {
      const key = this.getRouteKey(route);

      this.storedRoutes.set(key, handle);
    }
  }

  /**
   * Determines if a route should be reused.
   * Returns true if the route being navigated to uses the same component
   * as a previously stored route. Only applies for editor routes.
   */
  shouldAttach(route: ActivatedRouteSnapshot): boolean {
    if (!this.isEditorRoute(route) || !route.component) {
      return false;
    }

    const key = this.getRouteKey(route);

    return this.storedRoutes.has(key);
  }

  /**
   * Retrieves the stored route handle for reuse. Returns null for non-editor routes.
   */
  retrieve(route: ActivatedRouteSnapshot): DetachedRouteHandle | null {
    if (!this.isEditorRoute(route)) {
      return null;
    }

    const key = this.getRouteKey(route);

    return this.storedRoutes.get(key) || null;
  }

  /**
   * Determines if a route should be reused when navigating.
   * For non-editor routes: uses Angular default (route config match only).
   * For editor routes: reuses when components are identical AND route paths match.
   */
  shouldReuseRoute(future: ActivatedRouteSnapshot, curr: ActivatedRouteSnapshot): boolean {
    const futureIsShell = this.isClientsShellRoute(future);
    const currIsShell = this.isClientsShellRoute(curr);

    // Workspaces / environments / chat: reuse shell across param-only navigation
    if (futureIsShell && currIsShell && future.component && future.component === curr.component) {
      return true;
    }

    const futureIsEditor = this.isEditorRoute(future);
    const currIsEditor = this.isEditorRoute(curr);

    if (!futureIsEditor || !currIsEditor) {
      return future.routeConfig === curr.routeConfig;
    }

    const routeConfigsMatch = future.routeConfig === curr.routeConfig;

    if (!future.component || !curr.component) {
      return routeConfigsMatch;
    }

    const componentsMatch = future.component === curr.component;
    const futurePath = future.routeConfig?.path || '';
    const currPath = curr.routeConfig?.path || '';
    const pathsMatch = futurePath === currPath;

    return componentsMatch && (routeConfigsMatch || pathsMatch);
  }

  /**
   * Generates a unique key for a route based on its component and path.
   * This key is used to store and retrieve route handles.
   *
   * IMPORTANT: Includes both component name and route path to ensure uniqueness
   * and prevent incorrect reuse of components from different routes.
   */
  private getRouteKey(route: ActivatedRouteSnapshot): string {
    const routePath = route.routeConfig?.path || route.url.map((segment) => segment.path).join('/');

    // Use component name/constructor as the primary key
    if (route.component) {
      const componentName = route.component.name || route.component.toString();

      // Include route path in the key to ensure routes with same component but different paths
      // don't reuse each other (though this shouldn't happen with our current routes)
      return `${componentName}:${routePath}`;
    }

    // Fallback to route path if no component
    return routePath;
  }
}
