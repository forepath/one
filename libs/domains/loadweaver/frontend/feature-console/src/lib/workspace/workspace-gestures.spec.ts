import { parse } from 'yaml';

import { resourceDocument } from './workspace-draft';
import { dropTarget, migrationEdges, movable, needsPinReason, withPlacement } from './workspace-gestures';
import { workspaceLayout, workspaceVisibleItems } from './workspace-layout';
import { workspaceModel, type WorkspaceItem } from './workspace-model';
import { WS_GRAPH, WS_RESOURCES } from './workspace-testing';

describe('workspace gestures (3.36 P4)', () => {
  const resources = WS_RESOURCES.map((r) =>
    r.kind === 'Deployment' && r.metadata.name === 'site'
      ? { ...r, spec: { compose: '# web tier\nservices:\n  web:\n    image: nginx:1\n' } }
      : r,
  );
  const model = workspaceModel(WS_GRAPH, resources);
  const item = (id: string) => model.byId.get(id) as WorkspaceItem;
  const visible = workspaceVisibleItems(model, 3);
  const boxes = workspaceLayout(model, visible);

  it('finds the node (else the site) under a drop point', () => {
    const n3 = boxes.get('node:n3');
    const c = boxes.get('site:c');

    expect(n3 && dropTarget(model, boxes, { x: n3.x + 5, y: n3.y + 5 }, 'stack:shop/site/web@n1')).toEqual({
      node: 'n3',
    });
    expect(c && dropTarget(model, boxes, { x: c.x + 2, y: c.y + 2 }, 'stack:shop/site/web@n1')).toEqual({ site: 'c' });
    expect(dropTarget(model, boxes, { x: -999, y: -999 }, 'x')).toBeNull();
  });

  it('moves services and VMs only; node pins need a reason', () => {
    expect(movable(item('stack:shop/site/web@n1'))).toBe(true);
    expect(movable(item('vm:shop/db1'))).toBe(true);
    expect(movable(item('node:n1'))).toBe(false);
    expect(movable(null)).toBe(false);
    expect(needsPinReason({ node: 'n1' })).toBe(true);
    expect(needsPinReason({ site: 'a' })).toBe(false);
  });

  it('writes the placement into the service’s compose (pin reason for nodes) and the VM spec', () => {
    const deployment = resourceDocument(item('deployment:shop/site')) as string;
    const pinned = withPlacement(deployment, item('stack:shop/site/web@n1'), { node: 'n3' }, 'local GPU');
    const compose = parse(parse(pinned).spec.compose);

    expect(compose.services.web['x-loadweaver']).toEqual({
      placement: { selector: { matchLabels: { 'loadweaver.com/node': 'n3' } } },
      pinned: { reason: 'local GPU' },
    });
    expect(parse(pinned).spec.compose).toContain('# web tier');

    const site = parse(parse(withPlacement(pinned, item('stack:shop/site/web@n1'), { site: 'b' })).spec.compose);

    expect(site.services.web['x-loadweaver']).toEqual({
      placement: { selector: { matchLabels: { 'loadweaver.com/site': 'b' } } },
    });

    const vm = withPlacement(resourceDocument(item('vm:shop/db1')) as string, item('vm:shop/db1'), { node: 'n1' });

    expect(parse(vm).spec.placement).toEqual({ selector: { matchLabels: { 'loadweaver.com/node': 'n1' } } });
    // No compose, nothing to change.
    expect(withPlacement('kind: Deployment\nspec: {}\n', item('stack:shop/site/web@n1'), { node: 'n1' })).toBe(
      'kind: Deployment\nspec: {}\n',
    );
  });

  it('draws migration arrows from moves, bundled on visible items', () => {
    const edges = migrationEdges(model, visible, [
      { action: 'move', replica: 'shop/site/web/0', from: 'n1', to: 'n3' },
      { action: 'move', replica: 'shop/site/web/2', from: 'n1', to: 'n3' },
      { action: 'move', replica: 'shop/lw-vm/db1/0', from: 'n3', to: 'n2' },
      { action: 'start', replica: 'shop/site/web/9', to: 'n1' },
    ]);

    expect(edges.map((e) => [e.source, e.target, (e.data['replicas'] as string[]).length])).toEqual([
      ['replica:shop/site/web/0', 'node:n3', 1],
      ['replica:shop/site/web/2', 'node:n3', 1],
      ['vm:shop/db1', 'node:n2', 1],
    ]);

    const far = migrationEdges(model, workspaceVisibleItems(model, 1), [
      { action: 'move', replica: 'shop/site/web/0', from: 'n1', to: 'n3' },
      { action: 'move', replica: 'shop/site/web/2', from: 'n1', to: 'n3' },
    ]);

    expect(far).toEqual([
      expect.objectContaining({
        source: 'node:n1',
        target: 'node:n3',
        data: expect.objectContaining({ replicas: ['shop/site/web/0', 'shop/site/web/2'] }),
      }),
    ]);
    expect(migrationEdges(model, visible, null)).toEqual([]);
  });
});
