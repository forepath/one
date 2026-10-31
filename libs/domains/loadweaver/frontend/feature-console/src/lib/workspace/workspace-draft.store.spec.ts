import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ConsoleSocketService, DraftsService, type Draft } from '@forepath/loadweaver/frontend/data-access-console';
import { of, throwError } from 'rxjs';

import { WorkspaceDraftStore } from './workspace-draft.store';

const draft = (o: Partial<Draft> = {}): Draft => ({
  id: 'd1',
  title: 'Draft',
  owner: 'u',
  projects: [],
  clusterScope: null,
  ops: [],
  version: 1,
  status: 'open',
  planId: null,
  createdAt: '',
  updatedAt: '',
  ...o,
});

describe('WorkspaceDraftStore (3.36 P3)', () => {
  let api: Record<string, jest.Mock>;
  let handlers: Record<string, (event: unknown) => void>;
  let store: WorkspaceDraftStore;

  beforeEach(() => {
    handlers = {};
    api = {
      list: jest.fn(() => of([draft()])),
      get: jest.fn(() => of(draft())),
      create: jest.fn(() => of(draft({ title: 'Untitled draft' }))),
      patch: jest.fn((_id: string, version: number) => of(draft({ version: version + 1, ops: [] }))),
      preview: jest.fn(() =>
        of({ version: 1, plan: { id: 'dry-run' }, topology: { overlay: {} }, conflicts: [{ key: 'Site//a' }] }),
      ),
      submit: jest.fn(() => of({ id: 'plan-1' })),
      discard: jest.fn(() => of(draft({ status: 'discarded' }))),
    };

    const socket = {
      on: (event: string, fn: (e: unknown) => void) => (handlers[event] = fn),
      removeAllListeners: jest.fn(),
      disconnect: jest.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        WorkspaceDraftStore,
        { provide: DraftsService, useValue: api },
        { provide: ConsoleSocketService, useValue: { open: jest.fn(async () => socket) } },
      ],
    });
    store = TestBed.inject(WorkspaceDraftStore);
  });

  it('loads the open drafts and follows them live', async () => {
    await store.connect();
    expect(store.drafts()).toHaveLength(1);

    await store.open('d1');
    handlers['draftPatch']({ draft: draft({ version: 2, title: 'by a collaborator' }) });
    expect(store.active()?.title).toBe('by a collaborator');
    expect(store.changedByOthers()).toBe(true);

    // Older versions (e.g. our own echo) don't replace the active draft.
    handlers['draftPatch']({ draft: draft({ version: 1, title: 'old' }) });
    expect(store.active()?.title).toBe('by a collaborator');

    handlers['draftPatch']({ draft: draft({ version: 3, status: 'submitted' }) });
    expect(store.active()).toBeNull();
    expect(store.drafts()).toEqual([]);

    handlers['draftsSnapshot']({ drafts: [draft({ id: 'd2' })] });
    expect(store.drafts().map((d) => d.id)).toEqual(['d2']);
  });

  it('keeps a failed load of the open drafts as loadError (Activity › Drafts shows it), cleared by the next load', async () => {
    api['list'].mockReturnValueOnce(
      throwError(() => new HttpErrorResponse({ status: 404, error: { message: 'GET drafts is not relayed' } })),
    );
    await store.connect();
    expect(store.drafts()).toEqual([]);
    expect(store.loadError()).toBe('GET drafts is not relayed');

    store.disconnect();
    await store.connect();
    expect(store.loadError()).toBeNull();
    expect(store.drafts()).toHaveLength(1);
  });

  it('creates an untitled draft on the first edit and sends the version', async () => {
    expect(await store.upsert('kind: Site\n')).toBe(true);
    expect(api['create']).toHaveBeenCalled();
    expect(api['patch']).toHaveBeenCalledWith('d1', 1, { set: [{ op: 'upsert', document: 'kind: Site\n' }] });
    expect(store.active()?.version).toBe(2);

    await store.remove({ kind: 'Policy', name: 'p', project: 'shop' });
    expect(api['patch']).toHaveBeenLastCalledWith('d1', 2, {
      set: [{ op: 'delete', kind: 'Policy', name: 'p', project: 'shop' }],
    });

    await store.revert({ kind: 'Policy', name: 'p', project: 'shop' });
    expect(api['patch']).toHaveBeenLastCalledWith('d1', 3, { remove: ['Policy/shop/p'] });
  });

  it('reloads the draft on a version conflict and asks to repeat the edit', async () => {
    await store.open('d1');
    api['patch'].mockReturnValueOnce(
      throwError(
        () => new HttpErrorResponse({ status: 409, error: { message: 'draft changed', draft: draft({ version: 7 }) } }),
      ),
    );

    expect(await store.rename('x')).toBe(false);
    expect(store.active()?.version).toBe(7);
    expect(store.error()).toContain('repeat');
  });

  it('previews, lists conflicts, resolves them and submits', async () => {
    await store.open('d1');
    store.active.set(
      draft({
        ops: [
          { op: 'upsert', kind: 'Site', name: 'a', project: null, document: 'x', baseGeneration: 1, by: 'u', at: '' },
        ],
      }),
    );
    await store.runPreview();
    expect(store.preview()?.plan.id).toBe('dry-run');
    expect(store.conflicts()).toHaveLength(1);

    await store.resolve(
      { key: 'Site//a', kind: 'Site', name: 'a', project: null, baseGeneration: 1, currentGeneration: 4 },
      'keep',
    );
    expect(api['patch']).toHaveBeenLastCalledWith('d1', 1, {
      set: [{ op: 'upsert', document: 'x', baseGeneration: 4 }],
    });
    expect(store.conflicts()).toEqual([]);

    api['submit'].mockReturnValueOnce(
      throwError(() => new HttpErrorResponse({ status: 409, error: { conflicts: [{ key: 'Site//a' }] } })),
    );
    expect(await store.submit()).toBeNull();
    expect(store.conflicts()).toHaveLength(1);

    expect((await store.submit())?.id).toBe('plan-1');
    expect(store.active()).toBeNull();
  });

  it('discards', async () => {
    await store.open('d1');
    expect(await store.discard()).toBe(true);
    expect(api['discard']).toHaveBeenCalledWith('d1', 1);
    expect(store.active()).toBeNull();
  });
});
