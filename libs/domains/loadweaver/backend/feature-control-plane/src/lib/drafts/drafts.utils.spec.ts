import type { AccessCaller } from '../access/access.utils';
import type { DraftOp } from './draft.entity';
import {
  applyDraftPatch,
  draftConflicts,
  draftDocumentBytes,
  draftOpKey,
  draftPlanInput,
  draftScope,
  mayEditDraft,
  mayPlanScope,
  parseIfMatch,
} from './drafts.utils';

const op = (o: Partial<DraftOp> & Pick<DraftOp, 'kind' | 'name'>): DraftOp => ({
  op: 'upsert',
  project: null,
  baseGeneration: 0,
  by: 'u1',
  at: '2026-10-27T10:00:00.000Z',
  ...o,
});
const caller = (o: Partial<AccessCaller> = {}): AccessCaller => ({ isApiKey: false, projects: new Map(), ...o });

describe('drafts utils (3.36)', () => {
  it('keys ops by kind / project / name', () => {
    expect(draftOpKey({ kind: 'Deployment', name: 'web', project: 'shop' })).toBe('Deployment/shop/web');
    expect(draftOpKey({ kind: 'Site', name: 'fra', project: null })).toBe('Site//fra');
  });

  it('replaces the op of the same key and removes by key', () => {
    const a = op({ kind: 'Deployment', name: 'web', project: 'shop', document: 'v1' });
    const b = op({ kind: 'Site', name: 'fra' });
    const next = applyDraftPatch([a, b], {
      set: [op({ kind: 'Deployment', name: 'web', project: 'shop', document: 'v2' })],
      remove: ['Site//fra'],
    });

    expect(next).toHaveLength(1);
    expect(next[0].document).toBe('v2');
  });

  it('derives the scope like a plan: projects and the cluster permission', () => {
    expect(
      draftScope([
        op({ kind: 'Deployment', name: 'web', project: 'shop' }),
        op({ kind: 'Policy', name: 'p', project: 'blog', op: 'delete' }),
      ]),
    ).toEqual({ projects: ['blog', 'shop'], clusterScope: null });
    expect(draftScope([op({ kind: 'Site', name: 'fra' })]).clusterScope).toBe('infra');
    expect(draftScope([op({ kind: 'Project', name: 'shop' })]).clusterScope).toBe('admin');
  });

  it('lets the owner and writers of every touched project edit', () => {
    const draft = { owner: 'u1', projects: ['shop', 'blog'], clusterScope: null };

    expect(mayEditDraft(caller(), 'u1', draft)).toBe(true);
    expect(mayEditDraft(caller({ projects: new Map([['shop', 'developer']]) }), 'u2', draft)).toBe(false);
    expect(
      mayEditDraft(
        caller({
          projects: new Map([
            ['shop', 'developer'],
            ['blog', 'admin'],
          ]),
        }),
        'u2',
        draft,
      ),
    ).toBe(true);
    expect(
      mayEditDraft(
        caller({
          projects: new Map([
            ['shop', 'viewer'],
            ['blog', 'admin'],
          ]),
        }),
        'u2',
        draft,
      ),
    ).toBe(false);
    // Auditors / infra operators read projects but don't write them.
    expect(mayEditDraft(caller({ clusterRole: 'auditor' }), 'u2', draft)).toBe(false);
    expect(mayEditDraft(caller({ clusterRole: 'cluster-admin' }), 'u2', draft)).toBe(true);
  });

  it('needs the cluster permission for cluster-level ops; empty drafts are the owner only', () => {
    const infra = { owner: 'u1', projects: [], clusterScope: 'infra' as const };

    expect(mayEditDraft(caller({ clusterRole: 'infra-operator' }), 'u2', infra)).toBe(true);
    expect(mayEditDraft(caller({ clusterRole: 'infra-operator' }), 'u2', { ...infra, clusterScope: 'admin' })).toBe(
      false,
    );
    expect(mayEditDraft(caller({ clusterRole: 'cluster-admin' }), 'u2', { ...infra, clusterScope: null })).toBe(false);
    expect(mayPlanScope(caller({ clusterRole: 'auditor' }), { projects: [], clusterScope: 'infra' })).toBe(false);
  });

  it('finds ops whose base generation moved (changed, created or deleted since)', () => {
    const ops = [
      op({ kind: 'Deployment', name: 'web', project: 'shop', baseGeneration: 3 }),
      op({ kind: 'Deployment', name: 'db', project: 'shop', baseGeneration: 2 }),
      op({ kind: 'Site', name: 'new', baseGeneration: 0 }),
      op({ kind: 'Site', name: 'gone', baseGeneration: 4, op: 'delete' }),
    ];
    const current = new Map([
      ['Deployment/shop/web', 3],
      ['Deployment/shop/db', 5],
      ['Site//new', 1],
    ]);

    expect(draftConflicts(ops, current).map((c) => [c.key, c.currentGeneration])).toEqual([
      ['Deployment/shop/db', 5],
      ['Site//new', 1],
      ['Site//gone', 0],
    ]);
  });

  it('builds the plan input: one YAML bundle and the deletions', () => {
    expect(
      draftPlanInput([
        op({ kind: 'Site', name: 'a', document: '---\nkind: Site\nmetadata: {name: a}\n' }),
        op({ kind: 'Site', name: 'b', document: 'kind: Site\nmetadata: {name: b}' }),
        op({ kind: 'Deployment', name: 'web', project: 'shop', op: 'delete' }),
        op({ kind: 'Node', name: 'n1', op: 'delete' }),
      ]),
    ).toEqual({
      documents: 'kind: Site\nmetadata: {name: a}\n---\nkind: Site\nmetadata: {name: b}\n',
      delete: [
        { kind: 'Deployment', name: 'web', project: 'shop' },
        { kind: 'Node', name: 'n1' },
      ],
    });
    expect(draftPlanInput([])).toEqual({});
  });

  it('counts document bytes and parses If-Match', () => {
    expect(draftDocumentBytes([op({ kind: 'Site', name: 'a', document: 'äb' })])).toBe(3);
    expect(parseIfMatch('"3"')).toBe(3);
    expect(parseIfMatch('W/"12"')).toBe(12);
    expect(parseIfMatch('7')).toBe(7);
    expect(parseIfMatch(['4'])).toBe(4);
    expect(parseIfMatch('*')).toBeNull();
    expect(parseIfMatch(undefined)).toBeNull();
  });
});
