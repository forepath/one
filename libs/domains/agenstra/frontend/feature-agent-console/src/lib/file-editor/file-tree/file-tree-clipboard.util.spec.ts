import {
  buildClipboardEntries,
  getClipboardModeForPath,
  isPathEqualOrDescendant,
  isPathOnClipboard,
  remapPathAfterMove,
  resolveCutDestinationPath,
  resolvePasteDestinationPath,
  resolvePasteTargetDirectory,
  wouldMoveDirectoryIntoSelf,
} from './file-tree-clipboard.util';

describe('file-tree-clipboard.util', () => {
  const resolveType = (path: string): 'file' | 'directory' | null => {
    if (path === 'src' || path === 'src/lib') {
      return 'directory';
    }

    if (path.endsWith('.ts') || path.endsWith('.md')) {
      return 'file';
    }

    return null;
  };

  describe('buildClipboardEntries', () => {
    it('keeps topmost roots and drops unknown paths', () => {
      expect(buildClipboardEntries(['src', 'src/a.ts', 'readme.md', 'missing'], resolveType)).toEqual([
        { path: 'src', type: 'directory' },
        { path: 'readme.md', type: 'file' },
      ]);
    });
  });

  describe('isPathOnClipboard / getClipboardModeForPath', () => {
    const copyState = {
      mode: 'copy' as const,
      entries: [
        { path: 'src', type: 'directory' as const },
        { path: 'readme.md', type: 'file' as const },
      ],
    };

    it('matches exact clipboard entry paths only', () => {
      expect(isPathOnClipboard(copyState, 'src')).toBe(true);
      expect(isPathOnClipboard(copyState, 'src/a.ts')).toBe(false);
      expect(isPathOnClipboard(null, 'src')).toBe(false);
    });

    it('returns the clipboard mode for staged paths', () => {
      expect(getClipboardModeForPath(copyState, 'readme.md')).toBe('copy');
      expect(getClipboardModeForPath({ ...copyState, mode: 'cut' }, 'src')).toBe('cut');
      expect(getClipboardModeForPath(copyState, 'other.ts')).toBeNull();
    });
  });

  describe('resolvePasteTargetDirectory', () => {
    it('uses directory focus as target', () => {
      expect(resolvePasteTargetDirectory('src/lib', resolveType)).toBe('src/lib');
    });

    it('uses parent of file focus', () => {
      expect(resolvePasteTargetDirectory('src/a.ts', resolveType)).toBe('src');
    });

    it('falls back to workspace root', () => {
      expect(resolvePasteTargetDirectory(null, resolveType)).toBe('.');
      expect(resolvePasteTargetDirectory('.', resolveType)).toBe('.');
    });
  });

  describe('resolvePasteDestinationPath', () => {
    it('appends numbered suffix on name collision', () => {
      expect(resolvePasteDestinationPath({ path: 'src/a.ts', type: 'file' }, 'dest', ['a.ts', 'b.ts'])).toBe(
        'dest/a (1).ts',
      );
    });

    it('keeps basename when free', () => {
      expect(resolvePasteDestinationPath({ path: 'src/a.ts', type: 'file' }, '.', ['other.ts'])).toBe('a.ts');
    });
  });

  describe('resolveCutDestinationPath', () => {
    it('keeps basename when free and suffixes on collision', () => {
      expect(resolveCutDestinationPath({ path: 'src/a.ts', type: 'file' }, 'dest', ['b.ts'])).toBe('dest/a.ts');
      expect(resolveCutDestinationPath({ path: 'src/a.ts', type: 'file' }, 'dest', ['a.ts'])).toBe('dest/a (1).ts');
    });
  });

  describe('isPathEqualOrDescendant', () => {
    it('matches exact and nested paths with segment boundaries', () => {
      expect(isPathEqualOrDescendant('app', 'app')).toBe(true);
      expect(isPathEqualOrDescendant('app/a.ts', 'app')).toBe(true);
      expect(isPathEqualOrDescendant('apps/a.ts', 'app')).toBe(false);
      expect(isPathEqualOrDescendant('lib', 'app')).toBe(false);
    });
  });

  describe('wouldMoveDirectoryIntoSelf', () => {
    it('blocks paste targets inside the source directory', () => {
      expect(wouldMoveDirectoryIntoSelf('src', 'src')).toBe(true);
      expect(wouldMoveDirectoryIntoSelf('src', 'src/lib')).toBe(true);
      expect(wouldMoveDirectoryIntoSelf('app', 'apps')).toBe(false);
      expect(wouldMoveDirectoryIntoSelf('src', 'lib')).toBe(false);
    });
  });

  describe('remapPathAfterMove', () => {
    it('remaps exact and nested paths', () => {
      expect(remapPathAfterMove('src/a.ts', 'src/a.ts', 'lib/a.ts')).toBe('lib/a.ts');
      expect(remapPathAfterMove('src/lib/a.ts', 'src', 'pkg')).toBe('pkg/lib/a.ts');
      expect(remapPathAfterMove('other.ts', 'src', 'pkg')).toBe('other.ts');
    });
  });
});
