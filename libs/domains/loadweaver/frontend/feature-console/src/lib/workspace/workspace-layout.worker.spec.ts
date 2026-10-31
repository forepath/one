import { workspaceLayout, workspaceVisibleItems } from './workspace-layout';
import { layoutWorkerSource, WorkspaceLayoutWorker } from './workspace-layout.worker';
import { workspaceModel } from './workspace-model';
import { WS_GRAPH, WS_RESOURCES } from './workspace-testing';

describe('workspace layout worker (3.36 P5)', () => {
  const model = workspaceModel(WS_GRAPH, WS_RESOURCES);
  const visible = workspaceVisibleItems(model, 3);

  it('runs the layout from its own source, like a worker would', () => {
    const self: { onmessage?: (e: { data: unknown }) => void; postMessage: jest.Mock } = { postMessage: jest.fn() };

    const source = layoutWorkerSource();
    // Under coverage (CI) the function source calls its module's istanbul counters (`cov_x().s[0]++`): stub them.
    const counters = () => new Proxy({} as Record<string | symbol, unknown>, { get: (t, k) => (t[k] ??= 0) });
    const branches = () => new Proxy({} as Record<string | symbol, unknown>, { get: (t, k) => (t[k] ??= counters()) });
    const coverage = { s: counters(), f: counters(), b: branches(), bT: branches() };
    const istanbul = [...new Set(source.match(/\bcov_\w+/g) ?? [])];

    new Function('self', ...istanbul, source)(self, ...istanbul.map(() => () => coverage));
    self.onmessage?.({
      data: {
        key: 'k1',
        items: model.items.map(({ id, kind, label, project, parent, children }) => ({
          id,
          kind,
          label,
          project,
          parent,
          children,
        })),
        visible: [...visible],
      },
    });

    const [{ key, boxes }] = self.postMessage.mock.calls[0];

    expect(key).toBe('k1');
    expect(new Map(boxes)).toEqual(workspaceLayout(model, visible));
  });

  it('falls back to the main thread without Worker', async () => {
    const worker = new WorkspaceLayoutWorker(false);

    expect(worker.running).toBe(false);
    expect(await worker.layout(model, visible, 'k')).toEqual(workspaceLayout(model, visible));
    worker.terminate();
  });
});
