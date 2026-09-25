/** Soft cap for in-memory fallback when OPFS / Cache / IDB are unavailable. */
export const AGENT_FILE_BODY_RAM_MAX_BYTES = 10 * 1024 * 1024;

export type AgentFileBodyBackend = 'opfs' | 'cache' | 'idb' | 'ram';

export interface AgentFileBodyPutResult {
  backend: AgentFileBodyBackend;
}

const CACHE_NAME = 'agenstra-agent-file-bodies-v1';
const IDB_NAME = 'agenstra-agent-file-bodies';
const IDB_STORE = 'bodies';
const OPFS_DIR = 'agenstra-agent-file-bodies';

/**
 * Durable-ish browser storage for agent file bodies outside NgRx.
 * Preference: OPFS → Cache Storage → IndexedDB → RAM (small only).
 */
export class AgentFileBodyStoreImpl {
  private readonly ram = new Map<string, Blob>();
  private idbOpen: Promise<IDBDatabase> | null = null;

  buildKey(clientId: string, agentId: string, context: string, filePath: string): string {
    return `${clientId}\u0000${agentId}\u0000${context}\u0000${filePath}`;
  }

  async put(key: string, blob: Blob): Promise<AgentFileBodyPutResult> {
    const errors: string[] = [];

    try {
      await this.putOpfs(key, blob);
      this.ram.delete(key);

      return { backend: 'opfs' };
    } catch (error: unknown) {
      errors.push(this.errorMessage(error, 'opfs'));
    }

    try {
      await this.putCache(key, blob);
      this.ram.delete(key);

      return { backend: 'cache' };
    } catch (error: unknown) {
      errors.push(this.errorMessage(error, 'cache'));
    }

    try {
      await this.putIdb(key, blob);
      this.ram.delete(key);

      return { backend: 'idb' };
    } catch (error: unknown) {
      errors.push(this.errorMessage(error, 'idb'));
    }

    if (blob.size <= AGENT_FILE_BODY_RAM_MAX_BYTES) {
      this.ram.set(key, blob);

      return { backend: 'ram' };
    }

    throw new Error(`Unable to store file body (${blob.size} bytes); durable backends failed: ${errors.join('; ')}`);
  }

  async get(key: string): Promise<Blob | null> {
    const fromRam = this.ram.get(key);

    if (fromRam) {
      return fromRam;
    }

    try {
      const fromOpfs = await this.getOpfs(key);

      if (fromOpfs) {
        return this.coerceBlob(fromOpfs);
      }
    } catch {
      // try next
    }

    try {
      const fromCache = await this.getCache(key);

      if (fromCache) {
        return this.coerceBlob(fromCache);
      }
    } catch {
      // try next
    }

    try {
      return this.coerceBlob(await this.getIdb(key));
    } catch {
      return null;
    }
  }

  async getArrayBuffer(key: string): Promise<ArrayBuffer | null> {
    const blob = await this.get(key);

    if (!blob) {
      return null;
    }

    return this.blobToArrayBuffer(blob);
  }

  async delete(key: string): Promise<void> {
    this.ram.delete(key);

    try {
      await this.deleteOpfs(key);
    } catch {
      // ignore
    }

    try {
      await this.deleteCache(key);
    } catch {
      // ignore
    }

    try {
      await this.deleteIdb(key);
    } catch {
      // ignore
    }
  }

  private blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
    if (typeof blob.arrayBuffer === 'function') {
      return blob.arrayBuffer();
    }

    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'));
      reader.readAsArrayBuffer(blob);
    });
  }

  private coerceBlob(value: unknown): Blob | null {
    if (!value) {
      return null;
    }

    if (value instanceof Blob) {
      return value;
    }

    if (value instanceof ArrayBuffer) {
      return new Blob([value]);
    }

    if (ArrayBuffer.isView(value)) {
      // Copy into a fresh Uint8Array so BlobPart is always ArrayBuffer-backed (not SharedArrayBuffer).
      const copy = new Uint8Array(value.byteLength);

      copy.set(new Uint8Array(value.buffer as ArrayBuffer, value.byteOffset, value.byteLength));

      return new Blob([copy]);
    }

    return null;
  }

  private errorMessage(error: unknown, backend: string): string {
    const message = error instanceof Error ? error.message : String(error);

    return `${backend}: ${message}`;
  }

  private async hashKey(key: string): Promise<string> {
    const data = new TextEncoder().encode(key);
    const digest = await crypto.subtle.digest('SHA-256', data);
    const bytes = new Uint8Array(digest);

    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  private async putOpfs(key: string, blob: Blob): Promise<void> {
    const root = await this.requireOpfsRoot();
    const dir = await root.getDirectoryHandle(OPFS_DIR, { create: true });
    const name = await this.hashKey(key);
    const handle = await dir.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();

    try {
      await writable.write(blob);
    } finally {
      await writable.close();
    }
  }

  private async getOpfs(key: string): Promise<Blob | null> {
    const root = await this.requireOpfsRoot();
    const dir = await root.getDirectoryHandle(OPFS_DIR, { create: false });
    const name = await this.hashKey(key);
    const handle = await dir.getFileHandle(name, { create: false });
    const file = await handle.getFile();

    return file;
  }

  private async deleteOpfs(key: string): Promise<void> {
    const root = await this.requireOpfsRoot();
    const dir = await root.getDirectoryHandle(OPFS_DIR, { create: false });
    const name = await this.hashKey(key);

    await dir.removeEntry(name);
  }

  private async requireOpfsRoot(): Promise<FileSystemDirectoryHandle> {
    const storage = (globalThis.navigator as Navigator | undefined)?.storage;
    const getDirectory = storage?.getDirectory?.bind(storage);

    if (!getDirectory) {
      throw new Error('OPFS unavailable');
    }

    return getDirectory();
  }

  private cacheRequest(key: string): Request {
    return new Request(`https://agenstra.invalid/file-body/${encodeURIComponent(key)}`);
  }

  private async putCache(key: string, blob: Blob): Promise<void> {
    if (typeof caches === 'undefined' || typeof Response === 'undefined') {
      throw new Error('Cache Storage unavailable');
    }

    const cache = await caches.open(CACHE_NAME);

    await cache.put(this.cacheRequest(key), new Response(blob));
  }

  private async getCache(key: string): Promise<Blob | null> {
    if (typeof caches === 'undefined') {
      return null;
    }

    const cache = await caches.open(CACHE_NAME);
    const response = await cache.match(this.cacheRequest(key));

    if (!response) {
      return null;
    }

    return response.blob();
  }

  private async deleteCache(key: string): Promise<void> {
    if (typeof caches === 'undefined') {
      return;
    }

    const cache = await caches.open(CACHE_NAME);

    await cache.delete(this.cacheRequest(key));
  }

  private openIdb(): Promise<IDBDatabase> {
    if (this.idbOpen) {
      return this.idbOpen;
    }

    if (typeof indexedDB === 'undefined') {
      return Promise.reject(new Error('IndexedDB unavailable'));
    }

    this.idbOpen = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(IDB_NAME, 1);

      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    });

    return this.idbOpen;
  }

  private async putIdb(key: string, blob: Blob): Promise<void> {
    const db = await this.openIdb();
    const bytes = await this.blobToArrayBuffer(blob);

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);

      store.put({ type: blob.type, bytes }, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB put failed'));
    });
  }

  private async getIdb(key: string): Promise<Blob | null> {
    const db = await this.openIdb();

    return new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const request = store.get(key);

      request.onsuccess = () => {
        const value = request.result as { type?: string; bytes?: ArrayBuffer } | ArrayBuffer | Blob | undefined;

        if (!value) {
          resolve(null);

          return;
        }

        if (value instanceof Blob) {
          resolve(value);

          return;
        }

        if (value instanceof ArrayBuffer) {
          resolve(new Blob([value]));

          return;
        }

        if (value.bytes instanceof ArrayBuffer) {
          resolve(new Blob([value.bytes], { type: value.type || '' }));

          return;
        }

        resolve(null);
      };
      request.onerror = () => reject(request.error ?? new Error('IndexedDB get failed'));
    });
  }

  private async deleteIdb(key: string): Promise<void> {
    const db = await this.openIdb();

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);

      store.delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'));
    });
  }
}
