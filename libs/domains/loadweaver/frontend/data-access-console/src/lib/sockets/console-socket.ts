import { inject, Injectable } from '@angular/core';
import { USERS_JWT_STORAGE_KEY } from '@forepath/identity/frontend';
import {
  ENVIRONMENT,
  resolveApiWebsocketUrl,
  type LoadweaverConsoleEnvironment,
  type LoadweaverConsoleWebsocket,
} from '@forepath/loadweaver/frontend/util-configuration';
import { KeycloakService } from 'keycloak-angular';
import { io, type Socket } from 'socket.io-client';

const API_KEY_STORAGE_KEY = 'agent-controller-api-key';

/**
 * Opens the control plane's Socket.IO namespaces with the console's credentials. Browsers can't send headers on
 * WebSockets, so the bearer token goes in the handshake's `auth` (the gateways read it from there).
 */
@Injectable({ providedIn: 'root' })
export class ConsoleSocketService {
  private readonly environment = inject<LoadweaverConsoleEnvironment>(ENVIRONMENT);
  private readonly keycloak = inject(KeycloakService, { optional: true });

  async authHeader(): Promise<string | null> {
    const config = this.environment.authentication.config;
    const storage = typeof localStorage !== 'undefined' ? localStorage : null;

    if (config.type === 'api-key') {
      const key = config.apiKey ?? storage?.getItem(API_KEY_STORAGE_KEY);

      return key ? `Bearer ${key}` : null;
    }

    if (config.type === 'keycloak') {
      const token = await this.keycloak?.getToken().catch(() => null);

      return token ? `Bearer ${token}` : null;
    }

    const jwt = storage?.getItem(USERS_JWT_STORAGE_KEY);

    return jwt ? `Bearer ${jwt}` : null;
  }

  /** A connected (or connecting) socket for a namespace; `null` without a URL or credentials (checked up front). */
  async open(endpoint: LoadweaverConsoleWebsocket): Promise<Socket | null> {
    const url = resolveApiWebsocketUrl(this.environment.console.urls.websocket, endpoint);
    const authorization = await this.authHeader();

    if (!url || !authorization) return null;

    return io(url, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      randomizationFactor: 0.5,
      // A callback: every (re)connect fetches a fresh token (Keycloak tokens expire; a reconnect must not reuse one).
      auth: (cb: (data: object) => void) =>
        void this.authHeader().then((header) => cb({ Authorization: header ?? '' })),
    });
  }
}
