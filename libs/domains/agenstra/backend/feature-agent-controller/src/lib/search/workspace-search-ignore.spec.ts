import { sanitizeWorkspaceSearchPathFilter, shouldSkipWorkspaceIndexPath } from './workspace-search-ignore';

describe('workspace-search-ignore', () => {
  it('skips git, node_modules, and secrets', () => {
    expect(shouldSkipWorkspaceIndexPath('.git/HEAD')).toBe(true);
    expect(shouldSkipWorkspaceIndexPath('a/node_modules/b')).toBe(true);
    expect(shouldSkipWorkspaceIndexPath('.env.local')).toBe(true);
  });

  it('allows source files', () => {
    expect(shouldSkipWorkspaceIndexPath('src/main.ts')).toBe(false);
  });

  it('rejects path traversal in filters', () => {
    expect(sanitizeWorkspaceSearchPathFilter('../etc')).toBeNull();
    expect(sanitizeWorkspaceSearchPathFilter('src/app')).toBe('src/app');
  });
});
