import {
  isComparisonDropdownRoutePath,
  isProductDropdownRoutePath,
  portalRoutePathFromRouterUrl,
} from './container.component';

describe('container navigation helpers', () => {
  it('strips locale prefixes, query and fragment', () => {
    expect(portalRoutePathFromRouterUrl('/de/compare/nomad?x=1#matrix')).toBe('compare/nomad');
    expect(portalRoutePathFromRouterUrl('/en')).toBe('');
    expect(portalRoutePathFromRouterUrl('/apps')).toBe('apps');
  });

  it('marks the product and comparison dropdowns active for their pages', () => {
    expect(['', 'apps', 'remote-access', 'cloud'].every(isProductDropdownRoutePath)).toBe(true);
    expect(isProductDropdownRoutePath('pricing')).toBe(false);
    expect(isComparisonDropdownRoutePath('compare/kubernetes')).toBe(true);
    expect(isComparisonDropdownRoutePath('how-it-works')).toBe(false);
  });
});
