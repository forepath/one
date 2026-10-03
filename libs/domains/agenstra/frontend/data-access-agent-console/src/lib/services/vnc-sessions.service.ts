import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/agenstra/frontend/util-configuration';
import { ENVIRONMENT, resolveApiWebsocketUrl } from '@forepath/agenstra/frontend/util-configuration';
import { Observable } from 'rxjs';

export interface CreateVncSessionResponse {
  ticket: string;
  expiresIn: number;
}

/** Resolves the raw VNC WebSocket base URL from frontend environment config. */
export function resolveVncWebsocketUrl(environment: Environment): string | null {
  const websocket = environment.console.urls.websocket;

  // Only the object-form `vnc` key is an explicit override; string-form derivation still needs http→ws.
  const explicit = typeof websocket === 'object' && typeof websocket.vnc === 'string' ? websocket.vnc.trim() : '';

  if (explicit) {
    return explicit.replace(/\/$/, '');
  }

  const base = resolveApiWebsocketUrl(websocket, 'default');

  if (!base) {
    return null;
  }

  try {
    const u = new URL(base);
    const protocol = u.protocol === 'https:' || u.protocol === 'wss:' ? 'wss:' : 'ws:';

    if (u.pathname === '/clients' || u.pathname.endsWith('/clients')) {
      const path = u.pathname.slice(0, -'/clients'.length) || '';

      return `${protocol}//${u.host}${path}/vnc`;
    }

    return `${protocol}//${u.host}/socket/vnc`;
  } catch {
    if (base.endsWith('/clients')) {
      const withoutClients = base.slice(0, -'/clients'.length);
      const withWs = withoutClients.replace(/^http/, 'ws');

      return `${withWs}/vnc`;
    }

    return null;
  }
}

@Injectable({
  providedIn: 'root',
})
export class VncSessionsService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  private get apiUrl(): string {
    return this.environment.console.urls.restApi;
  }

  createSession(clientId: string, agentId: string): Observable<CreateVncSessionResponse> {
    return this.http.post<CreateVncSessionResponse>(
      `${this.apiUrl}/clients/${clientId}/agents/${agentId}/vnc/sessions`,
      {},
    );
  }

  resolveWebsocketBaseUrl(): string | null {
    return resolveVncWebsocketUrl(this.environment);
  }

  /**
   * Build noVNC WebSocket URL without embedding the ticket (tickets travel in Sec-WebSocket-Protocol).
   */
  buildWebsocketUrl(baseUrl: string): string {
    return baseUrl.replace(/\/$/, '');
  }

  /** Subprotocols: `binary` for noVNC framing + ticket-bearing protocol token. */
  buildWebsocketProtocols(ticket: string): string[] {
    return ['binary', `agenstra.vnc.${ticket}`];
  }
}
