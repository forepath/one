import {
  applyKnowledgeTreeSelectionGesture,
  collectVisibleDescendantIds,
  flattenVisibleKnowledgeNodes,
  getTopmostSelectedIds,
  isStrictKnowledgeDescendant,
  pruneSelectionAfterCollapse,
  wouldMoveKnowledgeIntoSelf,
  type KnowledgeTreeSelectableNode,
} from './knowledge-tree-selection.util';

describe('knowledge-tree-selection.util', () => {
  const parentMap: Record<string, string | null> = {
    folder: null,
    a: 'folder',
    nested: 'folder',
    b: 'nested',
    c: 'folder',
    page: null,
  };

  const resolveParentId = (id: string): string | null => parentMap[id] ?? null;

  const tree: KnowledgeTreeSelectableNode[] = [
    {
      id: 'folder',
      nodeType: 'folder',
      parentId: null,
      expanded: true,
      children: [
        { id: 'a', nodeType: 'page', parentId: 'folder' },
        {
          id: 'nested',
          nodeType: 'folder',
          parentId: 'folder',
          expanded: true,
          children: [{ id: 'b', nodeType: 'page', parentId: 'nested' }],
        },
        { id: 'c', nodeType: 'page', parentId: 'folder' },
      ],
    },
    { id: 'page', nodeType: 'page', parentId: null },
  ];

  describe('isStrictKnowledgeDescendant', () => {
    it('detects strict descendants via parent links', () => {
      expect(isStrictKnowledgeDescendant('a', 'folder', resolveParentId)).toBe(true);
      expect(isStrictKnowledgeDescendant('b', 'folder', resolveParentId)).toBe(true);
      expect(isStrictKnowledgeDescendant('folder', 'folder', resolveParentId)).toBe(false);
      expect(isStrictKnowledgeDescendant('page', 'folder', resolveParentId)).toBe(false);
    });
  });

  describe('flattenVisibleKnowledgeNodes', () => {
    it('includes expanded children only', () => {
      expect(flattenVisibleKnowledgeNodes(tree).map((node) => node.id)).toEqual([
        'folder',
        'a',
        'nested',
        'b',
        'c',
        'page',
      ]);
    });

    it('skips children of collapsed folders', () => {
      const collapsed: KnowledgeTreeSelectableNode[] = [
        {
          id: 'folder',
          nodeType: 'folder',
          expanded: false,
          children: [{ id: 'a', nodeType: 'page' }],
        },
      ];

      expect(flattenVisibleKnowledgeNodes(collapsed).map((node) => node.id)).toEqual(['folder']);
    });
  });

  describe('collectVisibleDescendantIds', () => {
    it('returns currently visible descendants', () => {
      const folder = tree[0];

      expect(collectVisibleDescendantIds(folder)).toEqual(['a', 'nested', 'b', 'c']);
    });
  });

  describe('getTopmostSelectedIds', () => {
    it('drops descendants covered by a selected ancestor', () => {
      expect(getTopmostSelectedIds(['folder', 'a', 'b', 'page'], resolveParentId).sort()).toEqual(['folder', 'page']);
    });
  });

  describe('pruneSelectionAfterCollapse', () => {
    it('removes descendants of the collapsed folder', () => {
      const selected = new Set(['folder', 'a', 'b', 'page']);
      const pruned = pruneSelectionAfterCollapse(selected, 'folder', resolveParentId);

      expect([...pruned].sort()).toEqual(['folder', 'page']);
    });
  });

  describe('applyKnowledgeTreeSelectionGesture', () => {
    const visible = flattenVisibleKnowledgeNodes(tree);
    const folderNode = visible.find((node) => node.id === 'folder')!;
    const pageNode = visible.find((node) => node.id === 'a')!;

    it('plain click replaces selection and includes visible folder descendants', () => {
      const result = applyKnowledgeTreeSelectionGesture({
        gesture: 'plain',
        node: folderNode,
        visibleNodes: visible,
        previousSelected: new Set(['page']),
        selectionAnchorId: 'page',
      });

      expect([...result.selectedIds].sort()).toEqual(['a', 'b', 'c', 'folder', 'nested']);
      expect(result.selectionAnchorId).toBe('folder');
    });

    it('ctrl click toggles a node without clearing others', () => {
      const first = applyKnowledgeTreeSelectionGesture({
        gesture: 'ctrl',
        node: pageNode,
        visibleNodes: visible,
        previousSelected: new Set(['page']),
        selectionAnchorId: 'page',
      });

      expect(first.selectedIds.has('page')).toBe(true);
      expect(first.selectedIds.has('a')).toBe(true);

      const second = applyKnowledgeTreeSelectionGesture({
        gesture: 'ctrl',
        node: pageNode,
        visibleNodes: visible,
        previousSelected: first.selectedIds,
        selectionAnchorId: first.selectionAnchorId,
      });

      expect(second.selectedIds.has('a')).toBe(false);
      expect(second.selectedIds.has('page')).toBe(true);
    });

    it('shift click selects a contiguous visible range and keeps the anchor', () => {
      const result = applyKnowledgeTreeSelectionGesture({
        gesture: 'shift',
        node: visible.find((node) => node.id === 'c')!,
        visibleNodes: visible,
        previousSelected: new Set(),
        selectionAnchorId: 'a',
      });

      expect([...result.selectedIds].sort()).toEqual(['a', 'b', 'c', 'nested']);
      expect(result.selectionAnchorId).toBe('a');
    });
  });

  describe('wouldMoveKnowledgeIntoSelf', () => {
    it('blocks paste targets inside the source folder', () => {
      expect(wouldMoveKnowledgeIntoSelf('folder', 'folder', resolveParentId)).toBe(true);
      expect(wouldMoveKnowledgeIntoSelf('folder', 'nested', resolveParentId)).toBe(true);
      expect(wouldMoveKnowledgeIntoSelf('folder', null, resolveParentId)).toBe(false);
      expect(wouldMoveKnowledgeIntoSelf('a', 'page', resolveParentId)).toBe(false);
    });
  });
});
