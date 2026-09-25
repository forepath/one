import { AgentFileBodyStoreImpl } from './agent-file-body-store';

describe('AgentFileBodyStoreImpl', () => {
  let store: AgentFileBodyStoreImpl;

  beforeEach(() => {
    store = new AgentFileBodyStoreImpl();
  });

  it('builds a stable opaque key', () => {
    expect(store.buildKey('c', 'a', 'app', 'dir/file.txt')).toBe('c\u0000a\u0000app\u0000dir/file.txt');
  });

  it('stores and retrieves blobs', async () => {
    const key = store.buildKey('c', 'a', 'app', 'note.txt');
    const blob = new Blob(['hello'], { type: 'text/plain' });

    const result = await store.put(key, blob);

    expect(['opfs', 'cache', 'idb', 'ram']).toContain(result.backend);

    const bytes = await store.getArrayBuffer(key);

    expect(bytes).toBeTruthy();
    expect(new TextDecoder().decode(bytes!)).toBe('hello');
  });

  it('deletes stored bodies', async () => {
    const key = store.buildKey('c', 'a', 'app', 'gone.txt');

    await store.put(key, new Blob(['x']));
    await store.delete(key);

    expect(await store.get(key)).toBeNull();
  });
});
