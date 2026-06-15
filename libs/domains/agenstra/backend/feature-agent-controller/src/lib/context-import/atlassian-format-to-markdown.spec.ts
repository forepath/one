import {
  confluenceAncestorsRootToParent,
  confluencePageBodyHtml,
  confluencePageIdsNeedingParentPageShellFolder,
  confluencePageNeedsShellFolderForImportedSubtree,
  isJiraAdfDocument,
  jiraAdfToMarkdown,
  sliceAncestorsBelowRoot,
  trimShallowestConfluenceAncestorForSingleResultBatch,
} from './atlassian-format-to-markdown';

describe('confluenceAncestorsRootToParent', () => {
  it('reverses API order (immediate parent first) to root-to-parent', () => {
    const ordered = confluenceAncestorsRootToParent([
      { id: 'parent', title: 'Parent' },
      { id: 'space', title: 'Space' },
    ]);

    expect(ordered.map((a) => a.id)).toEqual(['space', 'parent']);
  });
});

describe('sliceAncestorsBelowRoot', () => {
  it('drops the root page and everything above it', () => {
    const sliced = sliceAncestorsBelowRoot(
      [
        { id: 'space', title: 'S' },
        { id: 'root', title: 'Root' },
        { id: 'mid', title: 'Mid' },
      ],
      'root',
    );

    expect(sliced.map((a) => a.id)).toEqual(['mid']);
  });
});

describe('trimShallowestConfluenceAncestorForSingleResultBatch', () => {
  it('drops the first ancestor only when the batch has exactly one page', () => {
    const chain = [{ id: 'space' }, { id: 'parent' }];

    expect(trimShallowestConfluenceAncestorForSingleResultBatch(1, chain).map((a) => a.id)).toEqual(['parent']);
    expect(trimShallowestConfluenceAncestorForSingleResultBatch(2, chain).map((a) => a.id)).toEqual([
      'space',
      'parent',
    ]);
  });
});

describe('confluencePageIdsNeedingParentPageShellFolder', () => {
  it('includes page ancestors that sit above an imported page in the batch', () => {
    const pages = [
      {
        id: 'child',
        ancestors: [
          { id: 'parent', type: 'page' },
          { id: 'space', type: 'page' },
        ],
      },
    ];

    expect(confluencePageIdsNeedingParentPageShellFolder(pages, null)).toEqual(new Set(['parent']));
  });

  it('does not treat the shallowest ancestor as a shell target when the batch is a single leaf', () => {
    const pages = [
      {
        id: 'leaf',
        ancestors: [{ id: 'space', type: 'page' }],
      },
    ];

    expect(confluencePageIdsNeedingParentPageShellFolder(pages, null).size).toBe(0);
  });
});

describe('confluencePageNeedsShellFolderForImportedSubtree', () => {
  it('is true when another batch page is nested under this page', () => {
    const parent = { id: 'parent', ancestors: [{ id: 'space', type: 'page' }] };
    const child = {
      id: 'child',
      ancestors: [
        { id: 'parent', type: 'page' },
        { id: 'space', type: 'page' },
      ],
    };

    expect(confluencePageNeedsShellFolderForImportedSubtree(parent, [parent, child], null)).toBe(true);
    expect(confluencePageNeedsShellFolderForImportedSubtree(child, [parent, child], null)).toBe(false);
  });
});

describe('confluencePageBodyHtml', () => {
  it('prefers non-empty storage over view', () => {
    expect(
      confluencePageBodyHtml({
        body: { storage: { value: '<p>storage</p>' }, view: { value: '<p>view</p>' } },
      }),
    ).toBe('<p>storage</p>');
    expect(confluencePageBodyHtml({ body: { view: { value: '<p>view only</p>' } } })).toBe('<p>view only</p>');
    expect(
      confluencePageBodyHtml({
        body: { storage: { value: '   ' }, view: { value: '<p>fallback</p>' } },
      }),
    ).toBe('<p>fallback</p>');
  });
});

describe('jiraAdfToMarkdown', () => {
  it('renders ADF strike as plain text without ~~', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'gone', marks: [{ type: 'strike' }] }],
        },
      ],
    };
    const md = jiraAdfToMarkdown(doc);

    expect(md).toContain('gone');
    expect(md).not.toContain('~~');
  });

  it('converts taskList / taskItem to GFM checkboxes', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'taskList',
          attrs: { localId: 'list-1' },
          content: [
            {
              type: 'taskItem',
              attrs: { localId: 't1', state: 'TODO' },
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Open item' }],
                },
              ],
            },
            {
              type: 'taskItem',
              attrs: { localId: 't2', state: 'DONE' },
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Closed item' }],
                },
              ],
            },
          ],
        },
      ],
    };
    const md = jiraAdfToMarkdown(doc);

    expect(md).toContain('- [ ] Open item');
    expect(md).toContain('- [x] Closed item');
  });

  it('converts headings, lists, and marks', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Section' }],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'bold bit', marks: [{ type: 'strong' }] },
                    { type: 'text', text: ' and ' },
                    { type: 'text', text: 'code', marks: [{ type: 'code' }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const md = jiraAdfToMarkdown(doc);

    expect(md).toContain('## Section');
    expect(md).toContain('**bold bit**');
    expect(md).toContain('`code`');
    expect(md).toContain('- ');
  });

  it('isJiraAdfDocument rejects non-doc payloads', () => {
    expect(isJiraAdfDocument(null)).toBe(false);
    expect(isJiraAdfDocument({ type: 'paragraph' })).toBe(false);
    expect(isJiraAdfDocument({ type: 'doc', content: [] })).toBe(true);
  });
});
