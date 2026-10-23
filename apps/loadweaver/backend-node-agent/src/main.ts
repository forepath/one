import { runAgentCli } from '@forepath/loadweaver/backend/feature-node-agent';

import { USAGE } from './cli';

runAgentCli(process.argv.slice(2), USAGE).catch((error: unknown) => {
  // eslint-disable-next-line no-console -- CLI errors go to stderr before/without the Nest logger
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
