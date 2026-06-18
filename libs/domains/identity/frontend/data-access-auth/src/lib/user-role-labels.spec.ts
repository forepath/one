import { getUserRoleLabel } from './user-role-labels';

describe('getUserRoleLabel', () => {
  it('returns Admin for admin role', () => {
    expect(getUserRoleLabel('admin')).toContain('Admin');
  });

  it('returns User for user role', () => {
    expect(getUserRoleLabel('user')).toContain('User');
  });

  it('returns Unknown for null or empty role', () => {
    expect(getUserRoleLabel(null)).toContain('Unknown');
    expect(getUserRoleLabel('')).toContain('Unknown');
    expect(getUserRoleLabel(undefined)).toContain('Unknown');
  });

  it('returns Unknown with role value for unrecognized roles', () => {
    expect(getUserRoleLabel('custom-role')).toContain('custom-role');
  });
});
