import {
  FpcTreeNode,
  fpcFilterTree,
  fpcFlattenTree,
  fpcScrollIntoView,
  fpcTreeBranchIds,
  fpcTreePath,
  fpcVirtualWindow,
} from './tree.model';

const tree: FpcTreeNode[] = [
  {
    id: 'cluster',
    label: 'Cluster',
    children: [
      {
        id: 'site:a',
        label: 'Site A',
        children: [
          { id: 'node:n1', label: 'n1' },
          { id: 'node:n2', label: 'n2' },
        ],
      },
      { id: 'site:b', label: 'Site B', hasChildren: true },
    ],
  },
  { id: 'projects', label: 'Projects', children: [] },
];

describe('tree model', () => {
  it('flattens only expanded branches with ARIA positions', () => {
    const rows = fpcFlattenTree(tree, new Set(['cluster']));

    expect(rows.map((row) => row.node.id)).toEqual(['cluster', 'site:a', 'site:b', 'projects']);
    expect(rows[1]).toMatchObject({ level: 2, parentId: 'cluster', setSize: 2, posInSet: 1, expandable: true });
    expect(rows[2].expandable).toBe(true); // lazy
    expect(rows[3].expandable).toBe(false); // empty children

    expect(fpcFlattenTree(tree, new Set(['cluster', 'site:a'])).map((row) => row.node.id)).toContain('node:n2');
  });

  it('filters keeping ancestors and the matches with their children', () => {
    const filtered = fpcFilterTree(tree, (node) => node.label === 'n2');

    expect(filtered).toHaveLength(1);
    expect(filtered[0].children?.[0].children?.map((node) => node.id)).toEqual(['node:n2']);
    expect(fpcFilterTree(tree, (node) => node.id === 'site:a')[0].children?.[0].children).toHaveLength(2);
    expect(fpcTreeBranchIds(filtered)).toEqual(['cluster', 'site:a']);
  });

  it('finds the path to a node', () => {
    expect(fpcTreePath(tree, 'node:n1').map((node) => node.id)).toEqual(['cluster', 'site:a', 'node:n1']);
    expect(fpcTreePath(tree, 'missing')).toEqual([]);
  });

  it('computes the virtual window and scroll positions', () => {
    expect(fpcVirtualWindow(0, 100, 20, 1000, 2)).toEqual({ start: 0, end: 7 });
    expect(fpcVirtualWindow(400, 100, 20, 1000, 2)).toEqual({ start: 18, end: 27 });
    expect(fpcVirtualWindow(0, 100, 20, 0)).toEqual({ start: 0, end: 0 });
    expect(fpcScrollIntoView(10, 0, 100, 20)).toBe(120);
    expect(fpcScrollIntoView(2, 100, 100, 20)).toBe(40);
    expect(fpcScrollIntoView(6, 100, 100, 20)).toBe(100);
  });
});
