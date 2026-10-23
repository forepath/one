import { parse } from 'yaml';

import type { ConsoleResource } from '../types/resources.types';
import {
  checkComposeDocument,
  checkResourceDocument,
  composeOf,
  resourceKeyOf,
  resourceTemplate,
  resourceToYaml,
  withCompose,
} from './resource-yaml';

const deployment: ConsoleResource = {
  apiVersion: 'loadweaver.com/v1',
  kind: 'Deployment',
  metadata: { name: 'web', project: 'shop' },
  spec: { compose: 'services:\n  web:\n    image: nginx:1.27\n' },
};

describe('resource YAML', () => {
  it('renders a resource with its compose file as a block and reads its key back', () => {
    const text = resourceToYaml(deployment);

    expect(text).toContain('compose: |');
    expect(parse(text)).toEqual(deployment);
    expect(resourceKeyOf(text)).toEqual({ kind: 'Deployment', name: 'web', project: 'shop' });
    expect(resourceKeyOf('kind: [')).toBeNull();
    expect(resourceKeyOf('- a')).toBeNull();
  });

  it('builds templates per kind', () => {
    const policy = parse(resourceTemplate('WorkloadGroup', 'shop'));
    const site = parse(resourceTemplate('Site'));

    expect(policy).toMatchObject({ kind: 'WorkloadGroup', metadata: { name: 'new-workload-group', project: 'shop' } });
    expect(site).toEqual({ apiVersion: 'loadweaver.com/v1', kind: 'Site', metadata: { name: 'new-site' }, spec: {} });
    expect(parse(resourceTemplate('VirtualMachine', 'shop'))).toMatchObject({
      metadata: { name: 'new-virtual-machine', project: 'shop' },
      spec: { image: 'registry.lw/shop/debian-13:latest', disks: [{ source: 'image' }], nics: [{ name: 'eth0' }] },
    });
  });

  it('reads and replaces the compose file of a deployment, keeping comments', () => {
    const text = `# shop web\n${resourceToYaml(deployment)}`;
    const next = withCompose(text, 'services:\n  web:\n    image: nginx:1.28\n');

    expect(composeOf(text)).toBe('services:\n  web:\n    image: nginx:1.27\n');
    expect(next).toContain('# shop web');
    expect(composeOf(next ?? '')).toContain('nginx:1.28');
    expect(withCompose('a: [', 'x')).toBeNull();
    expect(composeOf('spec: {}')).toBeNull();
  });

  it('checks a document against the schema of its kind', () => {
    const schemas = { Site: { type: 'object', required: ['spec'] } };

    expect(checkResourceDocument({ kind: 'Site' }, schemas, ['Site'])).toEqual([
      { path: [], message: 'missing property "spec"' },
    ]);
    expect(checkResourceDocument({ kind: 'Nope' }, schemas, ['Site'])).toEqual([
      { path: ['kind'], message: 'unknown kind "Nope" (one of Site)' },
    ]);
    expect(checkResourceDocument({ kind: 'Policy' }, schemas, [])).toEqual([]);
    expect(checkResourceDocument({}, schemas, [])).toEqual([{ path: [], message: 'missing property "kind"' }]);
    expect(checkResourceDocument('x', schemas, [])).toHaveLength(1);
  });

  it("doesn't take inherited members for schemas of kinds", () => {
    const schemas = { Site: { type: 'object', required: ['spec'] } };

    for (const kind of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(checkResourceDocument({ kind }, schemas, ['Site'])).toEqual([
        { path: ['kind'], message: `unknown kind "${kind}" (one of Site)` },
      ]);
      expect(checkResourceDocument({ kind }, schemas, [])).toEqual([]);
    }
  });

  it('checks compose files for services with images', () => {
    expect(checkComposeDocument({ services: { web: { image: 'nginx' } } })).toEqual([]);
    expect(checkComposeDocument({ services: { web: { build: '.' } } })).toEqual([
      { path: ['services', 'web'], message: 'missing property "image" (build is not supported)' },
    ]);
    expect(checkComposeDocument({})).toEqual([{ path: [], message: 'missing property "services"' }]);
  });
});
