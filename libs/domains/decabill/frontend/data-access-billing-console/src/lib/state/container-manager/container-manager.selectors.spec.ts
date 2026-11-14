import { initialContainerManagerState } from './container-manager.reducer';
import {
  selectContainerManagerContainers,
  selectContainerManagerLoadingAny,
  selectContainerManagerSelectedContainer,
} from './container-manager.selectors';

describe('containerManagerSelectors', () => {
  const state = {
    containerManager: {
      ...initialContainerManagerState,
      containers: [
        {
          id: 'ctr-1',
          name: 'web',
          image: 'nginx',
          state: 'running',
          status: 'Up',
          createdAt: null,
          stats: null,
        },
      ],
      selectedContainerId: 'ctr-1',
      loadingContainers: true,
      loadingNetworks: false,
      loadingStatsHistory: false,
    },
  };

  it('selects containers', () => {
    expect(selectContainerManagerContainers(state)).toHaveLength(1);
  });

  it('selects the selected container', () => {
    expect(selectContainerManagerSelectedContainer(state)?.id).toBe('ctr-1');
  });

  it('selects loading any', () => {
    expect(selectContainerManagerLoadingAny(state)).toBe(true);
  });
});
