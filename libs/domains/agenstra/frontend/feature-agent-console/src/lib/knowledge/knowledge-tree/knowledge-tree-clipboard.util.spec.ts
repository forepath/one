import {
  buildKnowledgeClipboardEntries,
  getKnowledgeClipboardModeForId,
  isKnowledgeIdOnClipboard,
  resolveKnowledgePasteTargetParentId,
  wouldMoveKnowledgeIntoSelf,
} from './knowledge-tree-clipboard.util';

describe('knowledge-tree-clipboard.util', () => {
  const parentMap: Record<string, string | null> = {
    folder: null,
    a: 'folder',
    nested: 'folder',
    page: null,
  };

  const resolveParentId = (id: string): string | null => parentMap[id] ?? null;

  const resolveNode = (id: string) => {
    if (id === 'folder') {
      return { id: 'folder', nodeType: 'folder' as const, parentId: null, title: 'Folder' };
    }

    if (id === 'a') {
      return { id: 'a', nodeType: 'page' as const, parentId: 'folder', title: 'A' };
    }

    if (id === 'page') {
      return { id: 'page', nodeType: 'page' as const, parentId: null, title: 'Page' };
    }

    return null;
  };

  const resolveNodeType = (id: string): 'folder' | 'page' | null => {
    const node = resolveNode(id);

    return node?.nodeType ?? null;
  };

  describe('buildKnowledgeClipboardEntries', () => {
    it('keeps topmost roots and drops unknown ids', () => {
      expect(buildKnowledgeClipboardEntries(['folder', 'a', 'page', 'missing'], resolveNode, resolveParentId)).toEqual([
        { id: 'folder', nodeType: 'folder', parentId: null, title: 'Folder' },
        { id: 'page', nodeType: 'page', parentId: null, title: 'Page' },
      ]);
    });
  });

  describe('isKnowledgeIdOnClipboard / getKnowledgeClipboardModeForId', () => {
    const copyState = {
      mode: 'copy' as const,
      entries: [
        { id: 'folder', nodeType: 'folder' as const, parentId: null, title: 'Folder' },
        { id: 'page', nodeType: 'page' as const, parentId: null, title: 'Page' },
      ],
    };

    it('matches exact clipboard entry ids only', () => {
      expect(isKnowledgeIdOnClipboard(copyState, 'folder')).toBe(true);
      expect(isKnowledgeIdOnClipboard(copyState, 'a')).toBe(false);
      expect(isKnowledgeIdOnClipboard(null, 'folder')).toBe(false);
    });

    it('returns the clipboard mode for staged ids', () => {
      expect(getKnowledgeClipboardModeForId(copyState, 'page')).toBe('copy');
      expect(getKnowledgeClipboardModeForId({ ...copyState, mode: 'cut' }, 'folder')).toBe('cut');
      expect(getKnowledgeClipboardModeForId(copyState, 'other')).toBeNull();
    });
  });

  describe('resolveKnowledgePasteTargetParentId', () => {
    it('uses folder focus as target', () => {
      expect(resolveKnowledgePasteTargetParentId('folder', resolveNodeType, resolveParentId)).toBe('folder');
    });

    it('uses parent of page focus', () => {
      expect(resolveKnowledgePasteTargetParentId('a', resolveNodeType, resolveParentId)).toBe('folder');
    });

    it('falls back to workspace root', () => {
      expect(resolveKnowledgePasteTargetParentId(null, resolveNodeType, resolveParentId)).toBeNull();
      expect(resolveKnowledgePasteTargetParentId('page', resolveNodeType, resolveParentId)).toBeNull();
    });
  });

  describe('wouldMoveKnowledgeIntoSelf', () => {
    it('blocks paste targets inside the source folder', () => {
      expect(wouldMoveKnowledgeIntoSelf('folder', 'folder', resolveParentId)).toBe(true);
      expect(wouldMoveKnowledgeIntoSelf('folder', 'nested', resolveParentId)).toBe(true);
      expect(wouldMoveKnowledgeIntoSelf('folder', null, resolveParentId)).toBe(false);
    });
  });
});
