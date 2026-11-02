import { parseResourceDocuments, stringifyResourceDocuments } from './documents';

const bundle = `
apiVersion: loadweaver.com/v1
kind: Site
metadata: { name: fra1 }
spec: {}
---
apiVersion: loadweaver.com/v1
kind: Policy
metadata: { name: web-to-db, project: shop }
spec:
  from: [{ group: web }]
  to: [{ group: db }]
  rules: [{ ports: [5432] }]
`;

describe('resource documents', () => {
  it('parses a multi-document bundle and round-trips it', () => {
    const result = parseResourceDocuments(bundle);

    expect(result.ok).toBe(true);

    if (!result.ok) return;

    expect(result.resources.map((r) => r.kind)).toEqual(['Site', 'Policy']);

    const again = parseResourceDocuments(stringifyResourceDocuments(result.resources));

    expect(again).toEqual(result);
  });

  it('reports issues with document index', () => {
    const result = parseResourceDocuments(
      `${bundle}---\napiVersion: loadweaver.com/v1\nkind: Site\nmetadata: { name: Bad }\nspec: {}\n`,
    );

    expect(result).toEqual({ ok: false, issues: [expect.objectContaining({ document: 2, path: 'metadata.name' })] });
  });

  it('rejects duplicates, duplicate keys, syntax errors and alias bombs', () => {
    expect(
      parseResourceDocuments(
        `${bundle}---\napiVersion: loadweaver.com/v1\nkind: Site\nmetadata: { name: fra1 }\nspec: {}\n`,
      ).ok,
    ).toBe(false);
    expect(parseResourceDocuments('a: 1\na: 2\n').ok).toBe(false);
    expect(parseResourceDocuments('a: [\n').ok).toBe(false);

    const bomb = [
      'a: &a [x,x,x,x,x,x,x,x,x]',
      ...Array.from(
        { length: 9 },
        (_, i) =>
          `${String.fromCharCode(98 + i)}: &${String.fromCharCode(98 + i)} [*${String.fromCharCode(97 + i)},*${String.fromCharCode(97 + i)},*${String.fromCharCode(97 + i)},*${String.fromCharCode(97 + i)},*${String.fromCharCode(97 + i)},*${String.fromCharCode(97 + i)},*${String.fromCharCode(97 + i)}]`,
      ),
    ].join('\n');

    expect(parseResourceDocuments(bomb).ok).toBe(false);
  });

  it('ignores empty documents and rejects oversized bundles', () => {
    expect(parseResourceDocuments('---\n---\n')).toEqual({ ok: true, resources: [] });
    expect(parseResourceDocuments('x'.repeat(2 * 1024 * 1024 + 1)).ok).toBe(false);
  });
});
