import { createLoadweaverShell } from './shell';
import type { LoadweaverConsoleEnvironment } from './environment.interface';

const shell = createLoadweaverShell({
  production: true,
  socialPreviewImageUrl: 'https://loadweaver.com/assets/images/og-preview.png',
});

/** Defaults for a console served by the control plane's host; the runtime config (`/config`) sets the real URLs. */
export const environment: LoadweaverConsoleEnvironment = {
  ...shell,
  cookieConsent: { ...shell.cookieConsent, enabled: false },
  console: {
    urls: {
      restApi: '/api',
      frontend: '/',
      websocket: {
        default: '/socket/plans',
        plans: '/socket/plans',
        logs: '/socket/logs',
        terminals: '/socket/terminals',
        tunnels: '/socket/tunnels',
        topology: '/socket/topology',
      },
    },
  },
};
