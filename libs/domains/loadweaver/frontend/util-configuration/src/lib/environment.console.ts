import { createLoadweaverShell } from './shell';
import type { LoadweaverConsoleEnvironment } from './environment.interface';

const shell = createLoadweaverShell({
  production: false,
  socialPreviewImageUrl: 'http://localhost:4600/assets/images/og-preview.png',
});

export const environment: LoadweaverConsoleEnvironment = {
  ...shell,
  // The console runs next to a cluster's control plane: no marketing cookies, so no consent banner.
  cookieConsent: { ...shell.cookieConsent, enabled: false },
  console: {
    urls: {
      restApi: 'http://localhost:3400/api',
      frontend: 'http://localhost:4602',
      websocket: {
        default: 'http://localhost:3400/socket/plans',
        plans: 'http://localhost:3400/socket/plans',
        logs: 'http://localhost:3400/socket/logs',
        terminals: 'http://localhost:3400/socket/terminals',
        tunnels: 'http://localhost:3400/socket/tunnels',
        topology: 'http://localhost:3400/socket/topology',
      },
    },
  },
  // Local development runs against the local fleet service (`apps/loadweaver/backend-fleet`, port 3500): sign-in,
  // fleet views and every cluster view through the fleet's relay. Remove `mode` to talk to one control plane
  // (`console.urls`) directly.
  mode: 'fleet',
  fleet: {
    apiUrl: 'http://localhost:3500/api',
    websocketUrl: 'http://localhost:3500/socket/fleet',
  },
};
