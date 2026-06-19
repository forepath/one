import { getTenantId, getTenantIdOrDefault, runWithTenantId } from './tenant-id.storage';

describe('tenant-id.storage', () => {
  it('exposes tenant id inside runWithTenantId callback', () => {
    runWithTenantId('tenant-a', () => {
      expect(getTenantId()).toBe('tenant-a');
    });
  });

  it('clears tenant id after callback completes', () => {
    runWithTenantId('tenant-b', () => {
      expect(getTenantId()).toBe('tenant-b');
    });
    expect(getTenantId()).toBeUndefined();
  });

  it('getTenantIdOrDefault returns default when unset', () => {
    expect(getTenantIdOrDefault()).toBe('default');
    runWithTenantId('tenant-c', () => {
      expect(getTenantIdOrDefault()).toBe('tenant-c');
    });
  });
});
