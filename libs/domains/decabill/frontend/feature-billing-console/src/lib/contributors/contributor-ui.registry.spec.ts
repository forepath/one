import {
  collectContributorNavItems,
  collectContributorNgrx,
  collectContributorRoutes,
  collectContributorTabComponents,
} from './contributor-ui.registry';
import type { ContributorUiModule } from './contributor-ui.types';

describe('contributor UI registry merge', () => {
  const extraTab = class ExtraTab {
    subscriptionId = '';
    itemId = '';
    adminMode = false;
  };
  const extra: ContributorUiModule = {
    tabComponents: { 'extra-tab': extraTab },
    ngrx: {
      facades: [class ExtraFacade {}],
      states: [{ name: 'extra', reducer: ((state: unknown) => state) as never }],
      effects: { extraEffect$: {} },
    },
    routes: {
      customer: [{ path: 'extra-customer' }],
      admin: [{ path: 'extra-admin' }],
    },
    navItems: {
      customer: [
        {
          routerLink: ['/extra'],
          activePaths: ['/extra'],
          icon: 'bi-star',
          title: 'Extra',
          label: 'Extra',
        },
      ],
      admin: [
        {
          routerLink: ['/administration/extra'],
          activePaths: ['/administration/extra'],
          icon: 'bi-star',
          title: 'Extra admin',
          label: 'Extra admin',
        },
      ],
    },
  };

  it('merges tab components without overwriting the first id', () => {
    const first = class FirstTab {
      subscriptionId = '';
      itemId = '';
      adminMode = false;
    };
    const registry = collectContributorTabComponents([
      { tabComponents: { shared: first } },
      { tabComponents: { shared: extraTab, other: extraTab } },
    ]);

    expect(registry.shared).toBe(first);
    expect(registry.other).toBe(extraTab);
  });

  it('spreads ngrx facades, states, and effects', () => {
    const ngrx = collectContributorNgrx([extra]);

    expect(ngrx.facades).toHaveLength(1);
    expect(ngrx.states).toEqual([expect.objectContaining({ name: 'extra' })]);
    expect(ngrx.effects).toEqual({ extraEffect$: {} });
  });

  it('spreads customer and admin routes and nav items', () => {
    const routes = collectContributorRoutes([extra]);
    const nav = collectContributorNavItems([extra]);

    expect(routes.customer).toEqual([{ path: 'extra-customer' }]);
    expect(routes.admin).toEqual([{ path: 'extra-admin' }]);
    expect(nav.customer).toHaveLength(1);
    expect(nav.admin).toHaveLength(1);
  });
});
