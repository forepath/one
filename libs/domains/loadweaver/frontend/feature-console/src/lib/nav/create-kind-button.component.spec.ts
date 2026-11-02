import { createKindLabel, mayCreateKind } from './create-kind-button.component';

const access = (clusterRole: string | null, projects: Record<string, string> = {}) =>
  ({ clusterRole, projects, fleetMode: false }) as never;

describe('kind-specific create "+" (table-head action, 2026-10-29)', () => {
  it('labels with the readable kind', () => {
    expect(createKindLabel('StatusPage', 'en-US')).toBe('Create status page');
    expect(createKindLabel('DnsRecord', 'en-US')).toBe('Create DNS record');
  });

  it('shows only for roles that may create the kind there', () => {
    expect(mayCreateKind('Cluster', null, access('cluster-admin'))).toBe(false);
    expect(mayCreateKind('MaintenanceWindow', null, access('cluster-admin'))).toBe(true);
    expect(mayCreateKind('MaintenanceWindow', null, access(null, { shop: 'admin' }))).toBe(false);
    expect(mayCreateKind('StatusPage', 'shop', access(null, { shop: 'developer' }))).toBe(true);
    expect(mayCreateKind('StatusPage', 'shop', access(null, { shop: 'viewer' }))).toBe(false);
    expect(mayCreateKind('StatusPage', null, access(null, { shop: 'developer' }))).toBe(true);
    expect(mayCreateKind('DnsRecord', null, access(null, { shop: 'viewer' }))).toBe(false);
  });
});
