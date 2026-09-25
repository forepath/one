import { Injectable } from '@angular/core';

import { AgentFileBodyStoreImpl, type AgentFileBodyPutResult } from '../utils/agent-file-body-store';

/**
 * Injectable facade over {@link AgentFileBodyStoreImpl}.
 * Keeps large file bodies out of NgRx.
 */
@Injectable({
  providedIn: 'root',
})
export class AgentFileBodyStore {
  private readonly impl = new AgentFileBodyStoreImpl();

  buildKey(clientId: string, agentId: string, context: string, filePath: string): string {
    return this.impl.buildKey(clientId, agentId, context, filePath);
  }

  put(key: string, blob: Blob): Promise<AgentFileBodyPutResult> {
    return this.impl.put(key, blob);
  }

  get(key: string): Promise<Blob | null> {
    return this.impl.get(key);
  }

  getArrayBuffer(key: string): Promise<ArrayBuffer | null> {
    return this.impl.getArrayBuffer(key);
  }

  delete(key: string): Promise<void> {
    return this.impl.delete(key);
  }
}
