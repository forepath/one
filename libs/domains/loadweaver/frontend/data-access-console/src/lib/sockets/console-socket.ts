import { inject, Injectable } from '@angular/core';
import { USERS_JWT_STORAGE_KEY } from '@forepath/identity/frontend';
import {
  ENVIRONMENT,
  type LoadweaverConsoleEnvironment,
  type LoadweaverConsoleWebsocket,
} from '@forepath/loadweaver/frontend/util-configuration';
import { KeycloakService } from 'keycloak-angular';
import { io, type Socket } from 'socket.io-client';

import { ConsoleEndpointService } from '../services/console-endpoint.service';
import { FleetRelaySocket } from './fleet-relay-socket';

const API_KEY_STORAGE_KEY = 'agent-controller-api-key';

/**
 * Opens the control plane's Socket.IO namespaces with the console's credentials. Browsers can't send headers on
 * WebSockets, so the bearer token goes in the handshake's `auth` (the gateways read it from there).
 */
@Injectable({ providedIn: 'root' })
export class ConsoleSocketService {
  private readonly environment = inject<LoadweaverConsoleEnvironment>(ENVIRONMENT);
  private readonly keycloak = inject(KeycloakService, { optional: true });
  private readonly endpoints = inject(ConsoleEndpointService);

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

  /**
   * A connected (or connecting) socket for a namespace; `null` without a URL or credentials (checked up front). In
   * fleet mode it is the namespace of the active cluster through the fleet's socket relay ({@link FleetRelaySocket}).
   */
  async open(endpoint: LoadweaverConsoleWebsocket): Promise<Socket | null> {
    if (this.endpoints.fleetMode) {
      const clusterId = this.endpoints.activeClusterId();
      const fleetUrl = this.endpoints.fleetSocketUrl();
      const fleetAuthorization = await this.authHeader();

      if (!clusterId || !fleetUrl || !fleetAuthorization) return null;

      return new FleetRelaySocket(this.connect(fleetUrl), clusterId, endpoint).asSocket();
    }

    const url = this.endpoints.clusterSocketUrl(endpoint);
    const authorization = await this.authHeader();

    if (!url || !authorization) return null;

    return this.connect(url);
  }

  private connect(url: string): Socket {
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
