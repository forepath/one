import { shouldIgnoreWorkspaceIndexPath, toWorkspaceRelativePath } from './workspace-index-ignore';

describe('workspace-index-ignore', () => {
  describe('shouldIgnoreWorkspaceIndexPath', () => {
    it('ignores git and node_modules segments', () => {
      expect(shouldIgnoreWorkspaceIndexPath('.git/config')).toBe(true);
      expect(shouldIgnoreWorkspaceIndexPath('src/node_modules/x/index.js')).toBe(true);
    });

    it('ignores secret file names', () => {
      expect(shouldIgnoreWorkspaceIndexPath('.env')).toBe(true);
      expect(shouldIgnoreWorkspaceIndexPath('certs/server.pem')).toBe(true);
      expect(shouldIgnoreWorkspaceIndexPath('id_rsa')).toBe(true);
    });

    it('allows normal source paths', () => {
      expect(shouldIgnoreWorkspaceIndexPath('src/app.ts')).toBe(false);
      expect(shouldIgnoreWorkspaceIndexPath('README.md')).toBe(false);
    });
  });

  describe('toWorkspaceRelativePath', () => {
    it('strips base path', () => {
      expect(toWorkspaceRelativePath('/app/src/a.ts', '/app')).toBe('src/a.ts');
    });

    it('returns null for base itself or outside base', () => {
      expect(toWorkspaceRelativePath('/app', '/app')).toBeNull();
      expect(toWorkspaceRelativePath('/other/a.ts', '/app')).toBeNull();
    });
  });
});
