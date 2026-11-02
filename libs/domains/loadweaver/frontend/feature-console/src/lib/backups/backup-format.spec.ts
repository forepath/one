import {
  backupStatusLabel,
  canAdminister,
  canOperate,
  deletionStateLabel,
  isLocked,
  joinPath,
  keepReasonLabel,
  kitShareFileName,
  pathCrumbs,
  scopeLabel,
  sizeDelta,
} from './backup-format';

describe('backup format', () => {
  it('labels statuses, keep reasons and scopes', () => {
    expect(backupStatusLabel('succeeded')).toBe('Succeeded');
    expect(deletionStateLabel('pending')).toBe('Waiting for a second admin');
    expect(keepReasonLabel('monthly')).toBe('monthly');
    expect(keepReasonLabel('custom')).toBe('custom');
    expect(scopeLabel('project-shop')).toBe('shop');
    expect(scopeLabel('cluster')).toBe('Cluster');
  });

  it('knows who operates and administers a project', () => {
    const operator = { userId: 'u', clusterRole: null, projects: { shop: 'operator' as const } };
    const admin = { userId: 'u', clusterRole: null, projects: { shop: 'admin' as const } };
    const clusterAdmin = { userId: 'u', clusterRole: 'cluster-admin' as const, projects: {} };
    const auditor = { userId: 'u', clusterRole: 'auditor' as const, projects: {} };

    expect(canOperate(operator, 'shop')).toBe(true);
    expect(canOperate(operator, 'blog')).toBe(false);
    expect(canOperate(auditor, 'shop')).toBe(false);
    expect(canOperate(clusterAdmin, 'shop')).toBe(true);
    expect(canOperate(null, 'shop')).toBe(false);
    expect(canAdminister(operator, 'shop')).toBe(false);
    expect(canAdminister(admin, 'shop')).toBe(true);
    expect(canAdminister(clusterAdmin, null)).toBe(true);
  });

  it('handles paths, locks, size changes and share file names', () => {
    expect(pathCrumbs('uploads/2026', 'root')).toEqual([
      { label: 'root', path: '' },
      { label: 'uploads', path: 'uploads' },
      { label: '2026', path: 'uploads/2026' },
    ]);
    expect(joinPath('', 'a')).toBe('a');
    expect(joinPath('x', 'a')).toBe('x/a');
    expect(isLocked('2026-10-02T00:00:00.000Z', new Date('2026-10-01T00:00:00.000Z'))).toBe(true);
    expect(isLocked('2026-09-30T00:00:00.000Z', new Date('2026-10-01T00:00:00.000Z'))).toBe(false);
    expect(isLocked(null)).toBe(false);
    expect(sizeDelta(10, 4)).toBe(-6);
    expect(sizeDelta(null, 4)).toBeNull();
    expect(kitShareFileName('prod cluster', 2, 3)).toBe('loadweaver-recovery-kit-prod_cluster-g2-share-3.txt');
  });
});
