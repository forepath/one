import { BadRequestException } from '@nestjs/common';

import {
  DEFAULT_AGENT_WORKSPACE_ROOT,
  normalizeWorkspaceRoot,
  resolveSystemFilePath,
  resolveWorkspaceFilePath,
} from './agent-file-path.utils';

describe('agent-file-path.utils', () => {
  describe('normalizeWorkspaceRoot', () => {
    it('keeps absolute roots and strips trailing slashes', () => {
      expect(normalizeWorkspaceRoot('/app')).toBe('/app');
      expect(normalizeWorkspaceRoot('/app/')).toBe('/app');
      expect(normalizeWorkspaceRoot('/srv//work/./')).toBe('/srv/work');
    });

    it('falls back to the default root for empty, relative or traversing roots', () => {
      expect(normalizeWorkspaceRoot(undefined)).toBe(DEFAULT_AGENT_WORKSPACE_ROOT);
      expect(normalizeWorkspaceRoot('')).toBe(DEFAULT_AGENT_WORKSPACE_ROOT);
      expect(normalizeWorkspaceRoot('~/work')).toBe(DEFAULT_AGENT_WORKSPACE_ROOT);
      expect(normalizeWorkspaceRoot('/')).toBe(DEFAULT_AGENT_WORKSPACE_ROOT);
      expect(normalizeWorkspaceRoot('/app/../etc')).toBe(DEFAULT_AGENT_WORKSPACE_ROOT);
    });
  });

  describe('resolveWorkspaceFilePath', () => {
    it('joins relative and ./ paths under the workspace root', () => {
      expect(resolveWorkspaceFilePath('src/a.ts', '/app')).toEqual({
        scope: 'workspace',
        relativePath: 'src/a.ts',
        containerPath: '/app/src/a.ts',
      });
      expect(resolveWorkspaceFilePath('./src//b.ts', '/app').containerPath).toBe('/app/src/b.ts');
      expect(resolveWorkspaceFilePath('src\\win.ts', '/app').containerPath).toBe('/app/src/win.ts');
    });

    it('accepts absolute paths that already point inside the workspace', () => {
      expect(resolveWorkspaceFilePath('/app/src/a.ts', '/app')).toEqual({
        scope: 'workspace',
        relativePath: 'src/a.ts',
        containerPath: '/app/src/a.ts',
      });
    });

    it.each(['/etc/passwd', '/opt/workspace/other-agent/secret.txt', '/application/x', '/', '//etc/shadow'])(
      'rejects absolute path %s outside the workspace',
      (input) => {
        expect(() => resolveWorkspaceFilePath(input, '/app', { allowRoot: true })).toThrow(
          new BadRequestException('Path must stay within the agent workspace'),
        );
      },
    );

    it.each(['../etc/passwd', 'src/../../etc', '/app/../etc/passwd', 'a/..', '..\\etc'])(
      'rejects traversal in %s',
      (input) => {
        expect(() => resolveWorkspaceFilePath(input, '/app')).toThrow(
          new BadRequestException('Path traversal is not allowed'),
        );
      },
    );

    it('rejects the workspace root unless explicitly allowed', () => {
      expect(() => resolveWorkspaceFilePath('.', '/app')).toThrow(
        new BadRequestException('Path must not target the workspace root'),
      );
      expect(() => resolveWorkspaceFilePath('/app', '/app')).toThrow(BadRequestException);
      expect(resolveWorkspaceFilePath('.', '/app', { allowRoot: true })).toEqual({
        scope: 'workspace',
        relativePath: '',
        containerPath: '/app',
      });
    });

    it('rejects invalid inputs', () => {
      expect(() => resolveWorkspaceFilePath(undefined, '/app')).toThrow('Path must be a string, got undefined');
      expect(() => resolveWorkspaceFilePath('   ', '/app')).toThrow('Path cannot be empty');
      expect(() => resolveWorkspaceFilePath('a\0b', '/app')).toThrow('Path cannot contain null bytes');
      expect(() => resolveWorkspaceFilePath('dir\n/victim', '/app')).toThrow('Path cannot contain control characters');
      expect(() => resolveWorkspaceFilePath('a\x7fb', '/app')).toThrow('Path cannot contain control characters');
    });

    it('allows dot-prefixed names that are not traversal segments', () => {
      expect(resolveWorkspaceFilePath('.github/..hidden/file..txt', '/app').containerPath).toBe(
        '/app/.github/..hidden/file..txt',
      );
    });
  });

  describe('resolveSystemFilePath', () => {
    it('resolves relative and in-workspace paths to the workspace scope', () => {
      expect(resolveSystemFilePath('AGENTS.md', '/app')).toEqual({
        scope: 'workspace',
        relativePath: 'AGENTS.md',
        containerPath: '/app/AGENTS.md',
      });
      expect(resolveSystemFilePath('/app/AGENTS.md', '/app').scope).toBe('workspace');
    });

    it('resolves absolute paths outside the workspace to the system scope', () => {
      expect(resolveSystemFilePath('/home/agenstra/.config/opencode/skills/a.md', '/app')).toEqual({
        scope: 'system',
        containerPath: '/home/agenstra/.config/opencode/skills/a.md',
      });
      expect(resolveSystemFilePath('/opt//agenstra/./context/x', '/app')).toEqual({
        scope: 'system',
        containerPath: '/opt/agenstra/context/x',
      });
    });

    it.each(['/etc/agenstra/environment/environment', '/etc', '/usr/local/bin/x', '/root/.ssh/k', '/opt/workspace/a'])(
      'rejects protected system path %s',
      (input) => {
        expect(() => resolveSystemFilePath(input, '/app')).toThrow(
          'System file paths must not target protected system directories',
        );
      },
    );

    it('keeps similarly named non-protected roots usable', () => {
      expect(resolveSystemFilePath('/etcetera/a.md', '/app').scope).toBe('system');
      expect(resolveSystemFilePath('/opt/workspace-skills/a.md', '/app').scope).toBe('system');
    });

    it('rejects the filesystem root and traversal', () => {
      expect(() => resolveSystemFilePath('/', '/app')).toThrow('Path must not target the filesystem root');
      expect(() => resolveSystemFilePath('/opt/../etc/passwd', '/app')).toThrow('Path traversal is not allowed');
    });
  });
});
