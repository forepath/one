import { createAgenstraShell } from './shell';
import type { AgenstraAgentConsoleEnvironment } from './environment.interface';

export const environment: AgenstraAgentConsoleEnvironment = {
  ...createAgenstraShell({
    production: true,
    socialPreviewImageUrl: 'https://agenstra.com/assets/images/og-preview.png',
  }),
  console: {
    urls: {
      restApi: 'http://host.docker.internal:3100/api',
      websocket: {
        default: 'http://host.docker.internal:3100/socket/clients',
        vnc: 'ws://host.docker.internal:3100/socket/vnc',
      },
    },
  },
  chatModelOptions: {
    cursor: {},
    opencode: {},
  },
};
