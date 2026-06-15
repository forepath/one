import {
  clearAtlassianConnectionTestResult,
  clearAtlassianContextImportError,
  clearExternalImportMarkers,
  clearExternalImportMarkersFailure,
  clearExternalImportMarkersSuccess,
  createAtlassianConnection,
  createAtlassianConnectionFailure,
  createAtlassianConnectionSuccess,
  createExternalImportConfig,
  createExternalImportConfigSuccess,
  deleteAtlassianConnection,
  deleteAtlassianConnectionFailure,
  deleteAtlassianConnectionSuccess,
  deleteExternalImportConfig,
  deleteExternalImportConfigFailure,
  deleteExternalImportConfigSuccess,
  loadAtlassianContextImport,
  loadAtlassianContextImportBatch,
  loadAtlassianContextImportFailure,
  loadAtlassianContextImportSuccess,
  runExternalImportConfig,
  runExternalImportConfigFailure,
  runExternalImportConfigSuccess,
  testAtlassianConnection,
  testAtlassianConnectionFailure,
  testAtlassianConnectionSuccess,
  updateAtlassianConnection,
  updateAtlassianConnectionSuccess,
  updateExternalImportConfig,
  updateExternalImportConfigFailure,
  updateExternalImportConfigSuccess,
} from './context-import.actions';
import { atlassianContextImportReducer, initialAtlassianContextImportState } from './context-import.reducer';
import type { AtlassianSiteConnectionDto, ExternalImportConfigDto } from './context-import.types';

describe('atlassianContextImportReducer', () => {
  const conn = (over: Partial<AtlassianSiteConnectionDto> = {}): AtlassianSiteConnectionDto => ({
    id: '11111111-1111-1111-1111-111111111111',
    label: 'L',
    baseUrl: 'https://x.atlassian.net',
    accountEmail: 'a@b.com',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...over,
  });
  const cfg = (over: Partial<ExternalImportConfigDto> = {}): ExternalImportConfigDto => ({
    id: '22222222-2222-2222-2222-222222222222',
    provider: 'atlassian',
    importKind: 'jira',
    atlassianConnectionId: conn().id,
    clientId: '33333333-3333-3333-3333-333333333333',
    enabled: true,
    jql: 'project = X',
    importTargetTicketStatus: 'draft',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...over,
  });

  it('returns initial state for unknown action', () => {
    expect(atlassianContextImportReducer(undefined, { type: 'UNKNOWN' } as never)).toEqual(
      initialAtlassianContextImportState,
    );
  });

  it('handles load lifecycle', () => {
    const seeded = {
      ...initialAtlassianContextImportState,
      connections: [conn({ id: 'seed-c' })],
      configs: [cfg({ id: 'seed-f' })],
    };
    let s = atlassianContextImportReducer(seeded, loadAtlassianContextImport());

    expect(s.loading).toBe(true);
    expect(s.connections).toEqual([]);
    expect(s.configs).toEqual([]);

    s = atlassianContextImportReducer(
      s,
      loadAtlassianContextImportSuccess({ connections: [conn()], configs: [cfg()] }),
    );
    expect(s.loading).toBe(false);
    expect(s.connections.length).toBe(1);
    expect(s.configs.length).toBe(1);

    s = atlassianContextImportReducer(s, loadAtlassianContextImportFailure({ error: 'x' }));
    expect(s.error).toBe('x');
  });

  it('loadAtlassianContextImportBatch keeps partial connections and configs visible while loading', () => {
    const accumulated = [conn({ id: 'a' }), conn({ id: 'b' })];
    const accumulatedCfgs = [cfg({ id: 'c1' })];
    const s = atlassianContextImportReducer(
      { ...initialAtlassianContextImportState, configs: [cfg()] },
      loadAtlassianContextImportBatch({
        accumulatedConnections: accumulated,
        accumulatedConfigs: accumulatedCfgs,
        nextConnectionOffset: 10,
        nextConfigOffset: null,
      }),
    );

    expect(s.connections).toEqual(accumulated);
    expect(s.configs).toEqual(accumulatedCfgs);
    expect(s.loading).toBe(true);
  });

  it('clears runningConfigId on run success', () => {
    let s = atlassianContextImportReducer(initialAtlassianContextImportState, runExternalImportConfig({ id: 'cfg-1' }));

    expect(s.runningConfigId).toBe('cfg-1');

    s = atlassianContextImportReducer(s, runExternalImportConfigSuccess({ id: 'cfg-1' }));
    expect(s.runningConfigId).toBeNull();
  });

  it('handles connection create/update/delete and config CRUD lifecycle', () => {
    const createConnDto = { baseUrl: 'https://x.atlassian.net', accountEmail: 'a@b.com', apiToken: 't' };
    let s = atlassianContextImportReducer(
      initialAtlassianContextImportState,
      createAtlassianConnection({ dto: createConnDto }),
    );

    expect(s.saving).toBe(true);

    const cLate = conn({ id: 'late', createdAt: '2025-01-01T00:00:00Z' });
    const cEarly = conn({ id: 'early', createdAt: '2024-01-01T00:00:00Z' });

    s = atlassianContextImportReducer(s, createAtlassianConnectionSuccess({ connection: cLate }));
    s = atlassianContextImportReducer(s, createAtlassianConnectionSuccess({ connection: cEarly }));
    expect(s.connections.map((x) => x.id)).toEqual(['early', 'late']);

    s = atlassianContextImportReducer(s, updateAtlassianConnection({ id: 'early', dto: { label: 'X' } }));
    expect(s.saving).toBe(true);

    s = atlassianContextImportReducer(s, updateAtlassianConnectionSuccess({ connection: { ...cEarly, label: 'X' } }));
    expect(s.saving).toBe(false);
    expect(s.connections.find((x) => x.id === 'early')?.label).toBe('X');

    s = atlassianContextImportReducer(s, createAtlassianConnectionFailure({ error: 'e1' }));
    expect(s.saving).toBe(false);
    expect(s.error).toBe('e1');

    s = atlassianContextImportReducer(
      { ...s, error: null, connections: [cEarly], configs: [] },
      deleteAtlassianConnection({ id: 'early' }),
    );
    expect(s.deleting).toBe(true);

    s = atlassianContextImportReducer(s, deleteAtlassianConnectionSuccess({ id: 'early' }));
    expect(s.connections).toEqual([]);
    expect(s.deleting).toBe(false);

    s = atlassianContextImportReducer(s, deleteAtlassianConnectionFailure({ error: 'd1' }));
    expect(s.error).toBe('d1');
  });

  it('handles external import config create/update/delete and marker clear', () => {
    let s: ReturnType<typeof atlassianContextImportReducer> = {
      ...initialAtlassianContextImportState,
      connections: [conn()],
      configs: [],
    };
    const createCfgDto = {
      provider: 'atlassian' as const,
      importKind: 'jira' as const,
      atlassianConnectionId: conn().id,
      clientId: '33333333-3333-3333-3333-333333333333',
    };

    s = atlassianContextImportReducer(s, createExternalImportConfig({ dto: createCfgDto }));
    expect(s.saving).toBe(true);

    const newer = cfg({ id: 'n2', createdAt: '2025-01-01T00:00:00Z' });
    const older = cfg({ id: 'n1', createdAt: '2024-01-01T00:00:00Z' });

    s = atlassianContextImportReducer(s, createExternalImportConfigSuccess({ config: newer }));
    s = atlassianContextImportReducer(s, createExternalImportConfigSuccess({ config: older }));
    expect(s.configs.map((c) => c.id)).toEqual(['n1', 'n2']);

    s = atlassianContextImportReducer(s, updateExternalImportConfig({ id: 'n1', dto: { enabled: false } }));
    expect(s.saving).toBe(true);

    s = atlassianContextImportReducer(s, updateExternalImportConfigSuccess({ config: { ...older, enabled: false } }));
    expect(s.configs.find((c) => c.id === 'n1')?.enabled).toBe(false);

    s = atlassianContextImportReducer(s, updateExternalImportConfigFailure({ error: 'u1' }));
    expect(s.error).toBe('u1');

    s = atlassianContextImportReducer({ ...s, error: null }, deleteExternalImportConfig({ id: 'n1' }));
    expect(s.deleting).toBe(true);

    s = atlassianContextImportReducer(s, deleteExternalImportConfigSuccess({ id: 'n1' }));
    expect(s.configs.every((c) => c.id !== 'n1')).toBe(true);

    s = atlassianContextImportReducer(s, deleteExternalImportConfigFailure({ error: 'df' }));
    expect(s.error).toBe('df');
  });

  it('handles connection test and run failure', () => {
    let s = atlassianContextImportReducer(initialAtlassianContextImportState, testAtlassianConnection({ id: 'c1' }));

    expect(s.testingConnectionId).toBe('c1');

    s = atlassianContextImportReducer(
      s,
      testAtlassianConnectionSuccess({ connectionId: 'c1', result: { ok: true, message: 'ok' } }),
    );
    expect(s.testingConnectionId).toBeNull();
    expect(s.lastConnectionTest?.result.ok).toBe(true);

    s = atlassianContextImportReducer(s, testAtlassianConnectionFailure({ error: 't1' }));
    expect(s.error).toBe('t1');

    s = atlassianContextImportReducer({ ...s, error: null }, runExternalImportConfig({ id: 'f1' }));
    s = atlassianContextImportReducer(s, runExternalImportConfigFailure({ error: 'r1' }));
    expect(s.runningConfigId).toBeNull();
    expect(s.error).toBe('r1');
  });

  it('handles clear markers and clear helpers', () => {
    let s = atlassianContextImportReducer(initialAtlassianContextImportState, clearExternalImportMarkers({ id: 'f1' }));

    expect(s.clearingMarkersId).toBe('f1');

    s = atlassianContextImportReducer(s, clearExternalImportMarkersSuccess({ id: 'f1' }));
    expect(s.clearingMarkersId).toBeNull();

    s = atlassianContextImportReducer(s, clearExternalImportMarkersFailure({ error: 'm1' }));
    expect(s.error).toBe('m1');

    s = atlassianContextImportReducer(
      { ...s, error: 'x', lastConnectionTest: { connectionId: 'c', result: { ok: true } } },
      clearAtlassianContextImportError(),
    );
    expect(s.error).toBeNull();

    s = atlassianContextImportReducer(s, clearAtlassianConnectionTestResult());
    expect(s.lastConnectionTest).toBeNull();
  });

  it('removes configs tied to deleted connection', () => {
    const connection = conn({ id: 'conn-a' });
    const orphanCfg = cfg({ id: 'keep', atlassianConnectionId: 'other' });
    const linkedCfg = cfg({ id: 'gone', atlassianConnectionId: 'conn-a' });
    let s: ReturnType<typeof atlassianContextImportReducer> = {
      ...initialAtlassianContextImportState,
      connections: [connection],
      configs: [linkedCfg, orphanCfg],
    };

    s = atlassianContextImportReducer(s, deleteAtlassianConnectionSuccess({ id: 'conn-a' }));
    expect(s.connections).toEqual([]);
    expect(s.configs).toEqual([orphanCfg]);
  });
});
