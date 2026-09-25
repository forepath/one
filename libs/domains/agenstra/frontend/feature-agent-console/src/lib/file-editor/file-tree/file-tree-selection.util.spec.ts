import {
  applyFileTreeSelectionGesture,
  flattenVisibleTreeNodes,
  getParentPath,
  getPathBasename,
  getTopmostSelectedPaths,
  getVisibleDescendantPaths,
  isStrictPathDescendant,
  joinFileTreePath,
  pruneSelectionAfterCollapse,
  suggestCopyBasename,
  type FileTreeSelectableNode,
} from './file-tree-selection.util';

describe('file-tree-selection.util', () => {
  const tree: FileTreeSelectableNode[] = [
    {
      path: 'src',
      type: 'directory',
      expanded: true,
      children: [
        { path: 'src/a.ts', type: 'file' },
        {
          path: 'src/lib',
          type: 'directory',
          expanded: true,
          children: [{ path: 'src/lib/b.ts', type: 'file' }],
        },
        { path: 'src/c.ts', type: 'file' },
      ],
    },
    { path: 'readme.md', type: 'file' },
  ];

  describe('path helpers', () => {
    it('detects strict descendants', () => {
      expect(isStrictPathDescendant('src/a.ts', 'src')).toBe(true);
      expect(isStrictPathDescendant('src', 'src')).toBe(false);
      expect(isStrictPathDescendant('src2/a.ts', 'src')).toBe(false);
    });

    it('resolves parent and basename', () => {
      expect(getParentPath('src/lib/b.ts')).toBe('src/lib');
      expect(getParentPath('readme.md')).toBe('.');
      expect(getPathBasename('src/lib/b.ts')).toBe('b.ts');
    });

    it('joins paths for root and nested parents', () => {
      expect(joinFileTreePath('.', 'a.ts')).toBe('a.ts');
      expect(joinFileTreePath('src', 'a.ts')).toBe('src/a.ts');
    });
  });

  describe('flattenVisibleTreeNodes', () => {
    it('includes expanded children only', () => {
      const flat = flattenVisibleTreeNodes(tree).map((node) => node.path);

      expect(flat).toEqual(['src', 'src/a.ts', 'src/lib', 'src/lib/b.ts', 'src/c.ts', 'readme.md']);
    });

    it('skips children of collapsed directories', () => {
      const collapsed: FileTreeSelectableNode[] = [
        { path: 'src', type: 'directory', expanded: false, children: [{ path: 'src/a.ts', type: 'file' }] },
      ];

      expect(flattenVisibleTreeNodes(collapsed).map((node) => node.path)).toEqual(['src']);
    });
  });

  describe('getVisibleDescendantPaths', () => {
    it('returns currently visible descendants', () => {
      const visible = flattenVisibleTreeNodes(tree);

      expect(getVisibleDescendantPaths('src', visible)).toEqual(['src/a.ts', 'src/lib', 'src/lib/b.ts', 'src/c.ts']);
    });
  });

  describe('getTopmostSelectedPaths', () => {
    it('drops descendants covered by a selected ancestor', () => {
      expect(getTopmostSelectedPaths(['src', 'src/a.ts', 'src/lib/b.ts', 'readme.md'])).toEqual(['src', 'readme.md']);
    });
  });

  describe('pruneSelectionAfterCollapse', () => {
    it('removes descendants of the collapsed folder', () => {
      const selected = new Set(['src', 'src/a.ts', 'src/lib/b.ts', 'readme.md']);
      const pruned = pruneSelectionAfterCollapse(selected, 'src');

      expect([...pruned].sort()).toEqual(['readme.md', 'src']);
    });
  });

  describe('applyFileTreeSelectionGesture', () => {
    const visible = flattenVisibleTreeNodes(tree);
    const srcNode = visible.find((node) => node.path === 'src')!;
    const fileNode = visible.find((node) => node.path === 'src/a.ts')!;

    it('plain click replaces selection and includes visible folder descendants', () => {
      const result = applyFileTreeSelectionGesture({
        gesture: 'plain',
        node: srcNode,
        visibleNodes: visible,
        previousSelected: new Set(['readme.md']),
        selectionAnchorPath: 'readme.md',
      });

      expect([...result.selectedPaths].sort()).toEqual(['src', 'src/a.ts', 'src/c.ts', 'src/lib', 'src/lib/b.ts']);
      expect(result.selectionAnchorPath).toBe('src');
    });

    it('ctrl click toggles a path without clearing others', () => {
      const first = applyFileTreeSelectionGesture({
        gesture: 'ctrl',
        node: fileNode,
        visibleNodes: visible,
        previousSelected: new Set(['readme.md']),
        selectionAnchorPath: 'readme.md',
      });

      expect(first.selectedPaths.has('readme.md')).toBe(true);
      expect(first.selectedPaths.has('src/a.ts')).toBe(true);

      const second = applyFileTreeSelectionGesture({
        gesture: 'ctrl',
        node: fileNode,
        visibleNodes: visible,
        previousSelected: first.selectedPaths,
        selectionAnchorPath: first.selectionAnchorPath,
      });

      expect(second.selectedPaths.has('src/a.ts')).toBe(false);
      expect(second.selectedPaths.has('readme.md')).toBe(true);
    });

    it('shift click selects a contiguous visible range and keeps the anchor', () => {
      const result = applyFileTreeSelectionGesture({
        gesture: 'shift',
        node: visible.find((node) => node.path === 'src/c.ts')!,
        visibleNodes: visible,
        previousSelected: new Set(),
        selectionAnchorPath: 'src/a.ts',
      });

      expect([...result.selectedPaths].sort()).toEqual(['src/a.ts', 'src/c.ts', 'src/lib', 'src/lib/b.ts']);
      expect(result.selectionAnchorPath).toBe('src/a.ts');
    });
  });

  describe('suggestCopyBasename', () => {
    it('returns the original name when free', () => {
      expect(suggestCopyBasename('a.ts', ['b.ts'])).toBe('a.ts');
    });

    it('appends numbered suffixes while preserving extension', () => {
      expect(suggestCopyBasename('a.ts', ['a.ts'])).toBe('a (1).ts');
      expect(suggestCopyBasename('a.ts', ['a.ts', 'a (1).ts'])).toBe('a (2).ts');
    });
  });
});
