import { createLoadweaverProvider } from '@forepath/loadweaver/backend/feature-terraform-provider';
import { createPluginLogger, servePlugin } from '@forepath/loadweaver/backend/util-terraform-protocol';

import { PROVIDER_VERSION } from './version';

/**
 * `terraform-provider-loadweaver`: started by Terraform (go-plugin handshake, gRPC tfplugin6). Logs go to stderr in
 * hclog JSON (visible with `TF_LOG_PROVIDER=DEBUG`); stdout carries only the handshake line.
 */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  if (argv[0] === '--version' || argv[0] === 'version') {
    process.stdout.write(`terraform-provider-loadweaver ${PROVIDER_VERSION}\n`);

    return 0;
  }

  // Anything a dependency prints must not end up on stdout, where go-plugin expects the protocol line.
  console.log =
    console.info =
    console.debug =
      (...args: unknown[]) => process.stderr.write(`${args.map(String).join(' ')}\n`);

  const logger = createPluginLogger('provider.terraform-provider-loadweaver');
  const provider = createLoadweaverProvider({ version: PROVIDER_VERSION, logger });
  const running = await servePlugin({ provider: provider.handlers, logger, onShutdown: () => provider.stop() });

  if (!running) return 1;

  // Terraform forwards Ctrl-C itself (StopProvider); the plugin must not die on the terminal's SIGINT.
  process.on('SIGINT', () => logger.log('debug', 'SIGINT ignored; Terraform stops the provider over RPC'));
  process.on('SIGTERM', () => void running.stop());

  await running.done;

  return 0;
}

if (require.main === module)
  main().then(
    (code) => process.exit(code),
    (err: unknown) => {
      process.stderr.write(`terraform-provider-loadweaver: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    },
  );
