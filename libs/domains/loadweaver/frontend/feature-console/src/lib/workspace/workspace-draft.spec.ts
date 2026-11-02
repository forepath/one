import type { Draft } from '@forepath/loadweaver/frontend/data-access-console';

import {
  documentField,
  documentRef,
  draftChanges,
  draftOpKey,
  draftOpOf,
  draftResources,
  newResourceDocument,
  resourceDocument,
  schemaFormFields,
  withDocumentField,
} from './workspace-draft';
import { workspaceModel, type WorkspaceItem } from './workspace-model';
import { WS_GRAPH, WS_RESOURCES } from './workspace-testing';

const draft = (ops: Draft['ops']): Draft => ({
  id: 'd1',
  title: 'Draft',
  owner: 'u',
  projects: ['shop'],
  clusterScope: null,
  ops,
  version: 1,
  status: 'open',
  planId: null,
  createdAt: '',
  updatedAt: '',
});
const op = (o: Partial<Draft['ops'][number]>): Draft['ops'][number] => ({
  op: 'upsert',
  kind: 'Deployment',
  name: 'site',
  project: 'shop',
  baseGeneration: 1,
  by: 'u',
  at: '',
  ...o,
});
const SCHEMA = {
  type: 'object',
  properties: {
    spec: {
      type: 'object',
      required: ['site'],
      properties: {
        site: { type: 'string' },
        schedulable: { type: 'boolean' },
        mode: { enum: ['a', 'b'] },
        replicas: { type: 'integer' },
        labels: { type: 'object', additionalProperties: { type: 'string' } },
        resources: {
          type: 'object',
          properties: { cpu: { type: 'string' }, deep: { type: 'object', properties: { x: { type: 'string' } } } },
        },
        list: { type: 'array', items: { type: 'string' } },
      },
    },
  },
};

describe('workspace drafts (3.36 P3)', () => {
  it('keys ops and finds a resource’s op', () => {
    expect(draftOpKey({ kind: 'Site', name: 'a', project: null })).toBe('Site//a');

    const d = draft([op({})]);

    expect(draftOpOf(d, { kind: 'Deployment', name: 'site', project: 'shop' })?.op).toBe('upsert');
    expect(draftOpOf(d, { kind: 'Deployment', name: 'idle', project: 'shop' })).toBeNull();
    expect(draftOpOf(null, null)).toBeNull();
  });

  it('applies upserts to the declared resources (new ones appear) and keeps deletions', () => {
    const d = draft([
      op({
        kind: 'Site',
        name: 'new',
        project: null,
        document: 'apiVersion: loadweaver.com/v1\nkind: Site\nmetadata:\n  name: new\nspec: {}\n',
      }),
      op({ op: 'delete', kind: 'Policy', name: 'unused' }),
      op({ kind: 'Site', name: 'bad', project: null, document: ': not yaml: [' }),
    ]);
    const resources = draftResources(WS_RESOURCES, d);

    expect(resources.map((r) => r.metadata.name)).toEqual(expect.arrayContaining(['new', 'unused']));
    expect(resources).toHaveLength(WS_RESOURCES.length + 1);
    expect(workspaceModel(WS_GRAPH, resources).byId.get('site:new')?.drawn).toBe(true);
  });

  it('marks created, updated and deleted items', () => {
    const existing = new Set(['Deployment/shop/site']);

    expect(
      draftChanges(
        draft([
          op({}),
          op({ kind: 'Site', name: 'new', project: null }),
          op({ op: 'delete', kind: 'Policy', name: 'unused' }),
        ]),
        existing,
      ),
    ).toEqual({ 'deployment:shop/site': 'update', 'site:new': 'create', 'policy:shop/unused': 'delete' });
  });

  it('renders an item’s resource as YAML, or the draft’s version', () => {
    const model = workspaceModel(WS_GRAPH, WS_RESOURCES);
    const node = model.byId.get('node:n1') as WorkspaceItem;

    expect(resourceDocument(node)).toContain('kind: Node');
    expect(resourceDocument(node)).toContain('site: a');
    expect(
      resourceDocument(node, draft([op({ kind: 'Node', name: 'n1', project: null, document: 'kind: Node # mine\n' })])),
    ).toBe('kind: Node # mine\n');
    expect(resourceDocument(model.byId.get('replica:shop/site/web/0') as WorkspaceItem)).toContain('kind: Deployment');
    expect(resourceDocument(model.byId.get('external:0.0.0.0/0') as WorkspaceItem)).toBeNull();
  });

  it('generates form fields from the schema (scalars, one level deep)', () => {
    expect(schemaFormFields(SCHEMA).map((f) => [f.label, f.type, f.required])).toEqual([
      ['site', 'string', true],
      ['schedulable', 'boolean', false],
      ['mode', 'enum', false],
      ['replicas', 'number', false],
      ['resources.cpu', 'string', false],
    ]);
    expect(schemaFormFields(null)).toEqual([]);
    expect(schemaFormFields(true)).toEqual([]);
  });

  it('creates new documents with the required fields and edits fields keeping comments', () => {
    const doc = newResourceDocument('Node', 'n9', null, SCHEMA);

    expect(documentRef(doc)).toEqual({ kind: 'Node', name: 'n9', project: null });
    expect(documentField(doc, ['site'])).toBe('');

    const edited = withDocumentField(`# keep\n${doc}`, ['resources', 'cpu'], '2');

    expect(edited).toContain('# keep');
    expect(documentField(edited, ['resources', 'cpu'])).toBe('2');
    expect(documentField(withDocumentField(edited, ['resources', 'cpu'], ''), ['resources', 'cpu'])).toBeUndefined();
    expect(documentRef('nope: [')).toBeNull();
    expect(documentRef('kind: Site\n')).toBeNull();
    expect(newResourceDocument('Deployment', 'web', 'shop')).toContain('project: shop');
  });
});
