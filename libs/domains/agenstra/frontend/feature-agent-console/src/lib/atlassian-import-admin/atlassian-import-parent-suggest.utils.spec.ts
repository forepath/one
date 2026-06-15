import type { KnowledgeNodeDto, TicketResponseDto } from '@forepath/agenstra/frontend/data-access-agent-console';

import {
  filterKnowledgeFoldersForImportSuggest,
  filterTicketsForImportParentSuggest,
  flattenKnowledgeFolders,
} from './atlassian-import-parent-suggest.utils';

describe('atlassian-import-parent-suggest.utils', () => {
  const folder = (over: Partial<KnowledgeNodeDto> = {}): KnowledgeNodeDto => ({
    id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
    clientId: 'c1',
    nodeType: 'folder',
    title: 'Specs',
    sortOrder: 0,
    createdAt: '',
    updatedAt: '',
    shas: { short: 'abc12', long: 'abc1234567890abcdef012345678901234567890' },
    children: [],
    ...over,
  });
  const ticket = (over: Partial<TicketResponseDto> = {}): TicketResponseDto => ({
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    clientId: 'c1',
    title: 'Epic search',
    content: null,
    status: 'draft',
    priority: 'medium',
    parentId: null,
    automationEligible: false,
    createdAt: '',
    updatedAt: '',
    tasks: { open: 0, done: 0, children: { open: 0, done: 0 } },
    shas: { short: 'tsh1', long: 'tsh1longsha012345678901234567890' },
    ...over,
  });

  it('flattenKnowledgeFolders collects nested folders only', () => {
    const tree: KnowledgeNodeDto[] = [
      folder({ id: 'f1', title: 'Root', children: [folder({ id: 'f2', title: 'Nested' })] }),
      { ...folder({ id: 'p1', title: 'Page', nodeType: 'page' }), children: [] },
    ];
    const flat = flattenKnowledgeFolders(tree);

    expect(flat.map((f) => f.id)).toEqual(['f1', 'f2']);
  });

  it('filterKnowledgeFoldersForImportSuggest matches title and sha prefix', () => {
    const folders = [
      folder({ title: 'Archive', shas: { short: 'zzz99', long: 'z'.repeat(40) } }),
      folder({ title: 'Specs' }),
    ];

    expect(filterKnowledgeFoldersForImportSuggest(folders, 'spec', 10).map((f) => f.title)).toEqual(['Specs']);
    expect(filterKnowledgeFoldersForImportSuggest(folders, 'abc12', 10).map((f) => f.title)).toEqual(['Specs']);
  });

  it('filterTicketsForImportParentSuggest scopes to client and matches title', () => {
    const list = [ticket({ clientId: 'c1' }), ticket({ id: 'b2', clientId: 'c2', title: 'Other' })];

    expect(filterTicketsForImportParentSuggest(list, 'c1', 'epic').map((t) => t.id)).toEqual([
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    ]);
  });
});
