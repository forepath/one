import {
  confluencePageImportDepth,
  extractConfluenceInternalPageIdsFromHtml,
  sortConfluencePagesByImportDepthAsc,
  sortConfluencePagesByImportDepthDesc,
} from './confluence-import-structure.util';

describe('confluencePageImportDepth', () => {
  it('counts trimmed ancestor hops', () => {
    const child = {
      id: 'c',
      ancestors: [
        { id: 'p', type: 'page' },
        { id: 's', type: 'page' },
      ],
    };

    expect(confluencePageImportDepth(child, 1, null)).toBe(1);
    expect(confluencePageImportDepth(child, 2, null)).toBe(2);
  });
});

describe('sortConfluencePagesByImportDepthAsc', () => {
  it('orders shallow pages before deeper ones', () => {
    const shallow = { id: 'a', ancestors: [{ id: 's', type: 'page' }] };
    const deep = {
      id: 'b',
      ancestors: [
        { id: 'p', type: 'page' },
        { id: 's', type: 'page' },
      ],
    };
    const sorted = sortConfluencePagesByImportDepthAsc([deep, shallow], null);

    expect(sorted.map((p) => p.id)).toEqual(['a', 'b']);
  });
});

describe('sortConfluencePagesByImportDepthDesc', () => {
  it('orders deeper pages before shallow ones', () => {
    const shallow = { id: 'a', ancestors: [{ id: 's', type: 'page' }] };
    const deep = {
      id: 'b',
      ancestors: [
        { id: 'p', type: 'page' },
        { id: 's', type: 'page' },
      ],
    };
    const sorted = sortConfluencePagesByImportDepthDesc([shallow, deep], null);

    expect(sorted.map((p) => p.id)).toEqual(['b', 'a']);
  });
});

describe('extractConfluenceInternalPageIdsFromHtml', () => {
  it('collects ri:content-id and linked-resource ids', () => {
    const html =
      '<p><ac:link><ri:page ri:content-id="12345" /></ac:link></p>' + '<span data-linked-resource-id="67890"></span>';

    expect(extractConfluenceInternalPageIdsFromHtml(html).sort()).toEqual(['12345', '67890']);
  });

  it('deduplicates ids', () => {
    expect(extractConfluenceInternalPageIdsFromHtml('ri:content-id="1" ri:content-id="1"')).toEqual(['1']);
  });
});
