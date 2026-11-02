import { navAudienceAllows } from './nav-audience';

describe('navAudienceAllows', () => {
  it('shows access to members and wallboards to admins', () => {
    const viewer = { userId: 'u', clusterRole: null, projects: { shop: 'viewer' as const } };
    const projectAdmin = { userId: 'u', clusterRole: null, projects: { shop: 'admin' as const } };

    expect(navAudienceAllows({}, null)).toBe(true);
    expect(navAudienceAllows({ audience: 'member' }, null)).toBe(false);
    expect(navAudienceAllows({ audience: 'member' }, viewer)).toBe(true);
    expect(navAudienceAllows({ audience: 'admin' }, viewer)).toBe(false);
    expect(navAudienceAllows({ audience: 'admin' }, projectAdmin)).toBe(true);
    expect(navAudienceAllows({ audience: 'admin' }, { userId: 'u', clusterRole: 'cluster-admin', projects: {} })).toBe(
      true,
    );
  });
});
