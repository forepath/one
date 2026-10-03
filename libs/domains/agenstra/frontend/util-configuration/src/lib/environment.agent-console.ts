import { createAgenstraShell } from './shell';
import type { AgenstraAgentConsoleEnvironment } from './environment.interface';

export const environment: AgenstraAgentConsoleEnvironment = {
  ...createAgenstraShell({
    production: false,
    socialPreviewImageUrl: 'http://localhost:4300/assets/images/og-preview.png',
  }),
  console: {
    urls: {
      restApi: 'http://localhost:3100/api',
      websocket: {
        default: 'http://localhost:3100/socket/clients',
        vnc: 'ws://localhost:3100/socket/vnc',
      },
    },
  },
  chatModelOptions: {
    cursor: {},
    opencode: {},
  },
};
