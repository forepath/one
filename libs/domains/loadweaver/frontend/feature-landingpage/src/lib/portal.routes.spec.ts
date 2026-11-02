import { portalRoutes } from './portal.routes';

describe('portalRoutes', () => {
  const children = portalRoutes[0]?.children ?? [];
  const paths = children.map((route) => route.path);

  it('serves every page of the plan', () => {
    expect(paths).toEqual(
      expect.arrayContaining([
        '',
        'how-it-works',
        'apps',
        'remote-access',
        'cloud',
        'pricing',
        'compare/kubernetes',
        'compare/docker-swarm',
        'compare/nomad',
        'compare/coolify-dokploy',
        'compare/portainer',
        'legal/disclosure',
        'legal/privacy',
        'legal/terms',
        'contact',
      ]),
    );
  });

  it('redirects unknown paths home', () => {
    expect(children[children.length - 1]).toEqual({ path: '**', redirectTo: '' });
  });
});
