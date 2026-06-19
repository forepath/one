import { UserRoleLabelPipe } from './user-role-label.pipe';

describe('UserRoleLabelPipe', () => {
  const pipe = new UserRoleLabelPipe();

  it('returns admin label', () => {
    expect(pipe.transform('admin')).toContain('Admin');
  });

  it('returns user label', () => {
    expect(pipe.transform('user')).toContain('User');
  });

  it('returns unknown for empty role', () => {
    expect(pipe.transform(null)).toContain('Unknown');
  });
});
