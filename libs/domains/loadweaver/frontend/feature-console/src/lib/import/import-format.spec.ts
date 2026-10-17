import type { DiscoveredItem } from '@forepath/loadweaver/frontend/data-access-console';

import { formatBytes, initialSelections, needsHostname, selectionsBody, suggestedName } from './import-format';

const item = (id: string, name: string): DiscoveredItem => ({
  id,
  kind: 'compose',
  name,
  containers: [],
  services: [],
  ports: [],
  mounts: [],
  stateful: false,
  managed: false,
});

describe('import format', () => {
  it('suggests names and knows which ports need a hostname', () => {
    expect(suggestedName('My_Shop')).toBe('my-shop');
    expect(needsHostname({ protocol: 'tcp', hostPort: 80 })).toBe(true);
    expect(needsHostname({ protocol: 'tcp', hostPort: 8080 })).toBe(false);
    expect(formatBytes(1536)).toBe('1.5 KiB');
    expect(formatBytes(null)).toBe('–');
  });

  it('starts from the saved selection, otherwise ignores everything', () => {
    const items = [item('compose:shop', 'shop'), item('container:x', 'X_1')];

    expect(initialSelections(items, { items: [{ item: 'compose:shop', choice: 'import', project: 'p' }] })).toEqual([
      { item: 'compose:shop', choice: 'import', project: 'p' },
      { item: 'container:x', choice: 'ignore', deployment: 'x-1' },
    ]);
  });

  it('sends only what each choice needs', () => {
    expect(
      selectionsBody(
        [
          {
            item: 'compose:shop',
            choice: 'import',
            project: 'p',
            deployment: 'shop',
            http: { '80': 'a.example.com', '443': '' },
            variables: { A: '', B: 'x' },
          },
          { item: 'container:x', choice: 'ignore', project: 'p', deployment: 'x' },
        ],
        true,
      ),
    ).toEqual({
      items: [
        {
          item: 'compose:shop',
          choice: 'import',
          project: 'p',
          deployment: 'shop',
          http: { '80': 'a.example.com' },
          variables: { B: 'x' },
        },
        { item: 'container:x', choice: 'ignore' },
      ],
      wipeFormerIdentity: true,
    });
  });
});
