import {
  decodeFilterParam,
  encodeFilterParam,
  filterBySearchSyntax,
  formatSearch,
  parseSearch,
  removeSearchTerm,
  searchChips,
  setSearchFilter,
  type SearchDocument,
} from './list-search';

interface Item {
  name: string;
  kind: string;
  project: string | null;
  labels: string[];
}

const items: Item[] = [
  { name: 'web', kind: 'Deployment', project: 'shop', labels: ['tier=front'] },
  { name: 'db vm', kind: 'VirtualMachine', project: 'shop', labels: [] },
  { name: 'n1', kind: 'Node', project: null, labels: ['zone=a'] },
];

const doc = (item: Item): SearchDocument => ({
  text: [item.name],
  fields: { kind: item.kind, project: item.project, label: item.labels },
});

describe('search syntax', () => {
  it('parses text, fields, quotes and negation', () => {
    const parsed = parseSearch('web kind:Deployment -project:shop "db vm" name:"a b" kind:');

    expect(parsed.terms).toEqual([
      { field: null, value: 'web', negated: false },
      { field: 'kind', value: 'Deployment', negated: false },
      { field: 'project', value: 'shop', negated: true },
      { field: null, value: 'db vm', negated: false },
      { field: 'name', value: 'a b', negated: false },
    ]);
    expect(parsed.text).toHaveLength(2);
    expect(parsed.filters).toHaveLength(3);
  });

  it('treats unknown fields as text when fields are given', () => {
    expect(parseSearch('http://x kind:Node', ['kind']).terms).toEqual([
      { field: null, value: 'http://x', negated: false },
      { field: 'kind', value: 'Node', negated: false },
    ]);
    expect(parseSearch('-').terms).toEqual([{ field: null, value: '-', negated: false }]);
  });

  it('formats, removes and sets terms', () => {
    const query = 'web kind:Node name:"a b"';

    expect(formatSearch(parseSearch(query).terms)).toBe(query);
    expect(removeSearchTerm(query, { field: 'kind', value: 'node', negated: false })).toBe('web name:"a b"');
    expect(setSearchFilter('web kind:Node', 'kind', 'VirtualMachine')).toBe('web kind:VirtualMachine');
    expect(setSearchFilter('web kind:Node', 'kind', 'Volume', { append: true })).toBe('web kind:Node kind:Volume');
    expect(setSearchFilter('web kind:Node', 'kind', null)).toBe('web');
  });

  it('builds chips for field terms', () => {
    expect(searchChips(parseSearch('web -kind:Node'))).toEqual([
      { id: '-kind:Node', field: 'kind', value: 'Node', negated: true },
    ]);
  });

  it('filters with AND semantics, fields and negation', () => {
    const names = (query: string) => filterBySearchSyntax(items, query, doc).map((item) => item.name);

    expect(filterBySearchSyntax(items, '  ', doc)).toBe(items);
    expect(names('kind:vir')).toEqual(['db vm']);
    expect(names('project:shop -kind:VirtualMachine')).toEqual(['web']);
    expect(names('label:zone')).toEqual(['n1']);
    expect(names('shop')).toEqual(['web', 'db vm']); // free text also searches field values
    expect(names('"db vm" kind:Deployment')).toEqual([]);
  });

  it('round-trips the filter URL parameter', () => {
    const encoded = encodeFilterParam({ status: ['ready'], kind: ['Node', 'Virtual Machine'], empty: [] });

    expect(encoded).toBe('kind=Node|Virtual%20Machine;status=ready');
    expect(decodeFilterParam(encoded)).toEqual({ kind: ['Node', 'Virtual Machine'], status: ['ready'] });
    expect(encodeFilterParam({})).toBeNull();
    expect(decodeFilterParam('broken;%E0=x')).toEqual({});
  });
});
