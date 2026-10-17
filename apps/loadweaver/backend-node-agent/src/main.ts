import { parseArgs } from 'node:util';

import {
  AGENT_VERSION,
  AgentConnectionService,
  JoinService,
  NodeAgentModule,
} from '@forepath/loadweaver/backend/feature-node-agent';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { parseLabels, USAGE } from './cli';

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;

  if (!command || command === 'help' || command === '--help') {
    process.stdout.write(USAGE);

    return;
  }

  if (command === 'version') {
    process.stdout.write(`${AGENT_VERSION}\n`);

    return;
  }

  const app = await NestFactory.createApplicationContext(NodeAgentModule, { logger: ['log', 'warn', 'error'] });

  app.enableShutdownHooks();

  switch (command) {
    case 'join': {
      const { values } = parseArgs({
        args: rest,
        options: {
          server: { type: 'string' },
          token: { type: 'string' },
          name: { type: 'string' },
          'endpoint-host': { type: 'string' },
          label: { type: 'string', multiple: true },
          'ca-cert-hash': { type: 'string' },
        },
        strict: true,
      });
      const token = values.token ?? process.env['LOADWEAVER_JOIN_TOKEN'];

      if (!values.server || !token || !values.name)
        throw new Error('join needs --server, --name and a token (--token or LOADWEAVER_JOIN_TOKEN)');

      await app.get(JoinService).join({
        server: values.server,
        token,
        nodeName: values.name,
        endpointHost: values['endpoint-host'],
        labels: parseLabels(values.label ?? []),
        caCertHash: values['ca-cert-hash'],
      });
      await app.close();
      break;
    }
    case 'bootstrap': {
      const { values } = parseArgs({
        args: rest,
        options: { name: { type: 'string' }, 'public-host': { type: 'string' }, 'cluster-name': { type: 'string' } },
        strict: true,
      });

      if (!values.name || !values['public-host']) throw new Error('bootstrap needs --name and --public-host');

      await app
        .get(JoinService)
        .bootstrap({ nodeName: values.name, publicHost: values['public-host'], clusterName: values['cluster-name'] });
      await app.close();
      break;
    }
    case 'run':
      await app.get(AgentConnectionService).start();
      Logger.log(`Loadweaver node agent ${AGENT_VERSION} running`);
      break;
    default:
      await app.close();
      throw new Error(`unknown command ${command}\n${USAGE}`);
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  // eslint-disable-next-line no-console -- CLI errors go to stderr before/without the Nest logger
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
