import { rmSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  Server,
  ServerCredentials,
  status,
  type sendUnaryData,
  type ServerDuplexStream,
  type ServerUnaryCall,
  type ServerWritableStream,
  type UntypedServiceImplementation,
} from '@grpc/grpc-js';

import {
  clientCertificate,
  generateServerCertificate,
  hasMagicCookie,
  insecureTcpRefusal,
  listenTarget,
  negotiateProtocolVersion,
  NOT_STARTED_BY_TERRAFORM_MESSAGE,
  protocolLine,
  type ListenTarget,
} from './handshake';
import type { PluginLogger } from './logger';
import { serviceDefinition } from './protos';

export type ProviderRequest = Record<string, unknown>;
export type ProviderResponse = Record<string, unknown>;

/** Unary `tfplugin6.Provider` handlers by method name; methods without a handler answer `UNIMPLEMENTED`. */
export type ProviderHandlers = Partial<Record<string, (request: ProviderRequest) => Promise<ProviderResponse>>>;

export interface RunningPlugin {
  /** Resolves once the plugin stopped (controller `Shutdown`, SIGTERM or {@link RunningPlugin.stop}). */
  done: Promise<void>;
  address: string;
  stop(): Promise<void>;
}

const MAX_MESSAGE_BYTES = 256 * 1024 * 1024;

async function bind(server: Server, target: ListenTarget, credentials: ServerCredentials): Promise<string> {
  const bindAsync = (address: string) =>
    new Promise<number>((resolve, reject) =>
      server.bindAsync(address, credentials, (error, port) => (error ? reject(error) : resolve(port))),
    );

  if (target.network === 'unix') {
    await bindAsync(`unix:${target.path}`);

    return target.path;
  }

  const span = target.maxPort - target.minPort + 1;
  const start = Math.floor(Math.random() * span);

  for (let i = 0; i < span; i++) {
    const port = target.minPort + ((start + i) % span);

    try {
      await bindAsync(`${target.host}:${port}`);

      return `${target.host}:${port}`;
    } catch {
      // taken: next port
    }
  }

  throw new Error(`no free port in ${target.minPort}..${target.maxPort}`);
}

function unary(
  logger: PluginLogger,
  method: string,
  handler: (request: ProviderRequest) => Promise<ProviderResponse>,
): (call: ServerUnaryCall<ProviderRequest, ProviderResponse>, callback: sendUnaryData<ProviderResponse>) => void {
  return (call, callback) => {
    handler(call.request).then(
      (response) => callback(null, response),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);

        logger.log('error', `${method} failed`, { error: message });
        callback({ code: status.INTERNAL, details: `${method}: ${message}` });
      },
    );
  };
}

/**
 * Runs the plugin side of go-plugin: handshake, gRPC server with `tfplugin6.Provider` plus go-plugin's own services
 * (`plugin.GRPCStdio`, `plugin.GRPCController`, `plugin.GRPCBroker`) and the `grpc.health.v1.Health` check go-plugin
 * pings with service `plugin`. Prints the protocol line on `stdout` once the server listens.
 *
 * Returns `null` (after printing why to stderr) if the binary was not started by Terraform or Terraform only
 * offers protocol versions the plugin doesn't speak.
 */
export async function servePlugin(options: {
  provider: ProviderHandlers;
  logger: PluginLogger;
  env?: NodeJS.ProcessEnv;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
  /** Called on controller `Shutdown` / `StopProvider` paths before the server closes. */
  onShutdown?: () => void;
  platform?: NodeJS.Platform;
}): Promise<RunningPlugin | null> {
  const env = options.env ?? process.env;
  const stderr = options.stderr ?? ((line: string) => process.stderr.write(line));
  const stdout = options.stdout ?? ((line: string) => process.stdout.write(line));

  if (!hasMagicCookie(env)) {
    stderr(`${NOT_STARTED_BY_TERRAFORM_MESSAGE}\n`);

    return null;
  }

  const version = negotiateProtocolVersion(env);

  if (version === null) {
    stderr(
      `This provider speaks Terraform plugin protocol 6 only (Terraform 1.0 or newer); offered: ${env['PLUGIN_PROTOCOL_VERSIONS']}\n`,
    );

    return null;
  }

  const clientCert = clientCertificate(env);
  const refusal = insecureTcpRefusal(env, clientCert, options.platform);

  if (refusal) {
    stderr(`${refusal}\n`);

    return null;
  }

  const serverCert = clientCert ? await generateServerCertificate() : null;
  const credentials =
    clientCert && serverCert
      ? ServerCredentials.createSsl(
          Buffer.from(clientCert),
          [{ cert_chain: Buffer.from(serverCert.certificatePem), private_key: Buffer.from(serverCert.privateKeyPem) }],
          true,
        )
      : ServerCredentials.createInsecure();
  const server = new Server({
    'grpc.max_receive_message_length': MAX_MESSAGE_BYTES,
    'grpc.max_send_message_length': MAX_MESSAGE_BYTES,
  });
  const openStreams = new Set<{ end: () => void }>();
  let resolveDone: () => void = () => undefined;
  const done = new Promise<void>((resolve) => (resolveDone = resolve));
  const target = listenTarget(env, options.platform);
  let stopping: Promise<void> | null = null;

  const stop = (): Promise<void> => {
    stopping ??= (async () => {
      options.onShutdown?.();

      for (const stream of openStreams) stream.end();

      await new Promise<void>((resolve) => server.tryShutdown(() => resolve()));
      setTimeout(() => server.forceShutdown(), 2_000).unref();

      if (target.network === 'unix') rmSync(dirname(target.path), { recursive: true, force: true });

      resolveDone();
    })();

    return stopping;
  };

  const providerImpl: UntypedServiceImplementation = {};

  for (const [method, handler] of Object.entries(options.provider))
    if (handler) providerImpl[method] = unary(options.logger, method, handler);

  server.addService(serviceDefinition('tfplugin6.Provider'), providerImpl);
  server.addService(serviceDefinition('plugin.GRPCStdio'), {
    // The provider writes its logs to stderr directly; the stream only stays open so go-plugin doesn't complain.
    StreamStdio: (call: ServerWritableStream<unknown, unknown>) => {
      const stream = { end: () => call.end() };

      openStreams.add(stream);
      call.on('cancelled', () => openStreams.delete(stream));
    },
  });
  server.addService(serviceDefinition('plugin.GRPCController'), {
    Shutdown: (_call: ServerUnaryCall<unknown, unknown>, callback: sendUnaryData<unknown>) => {
      callback(null, {});
      setImmediate(() => void stop());
    },
  });
  server.addService(serviceDefinition('plugin.GRPCBroker'), {
    // No extra plugin connections are brokered; the stream is accepted and drained.
    StartStream: (call: ServerDuplexStream<unknown, unknown>) => {
      const stream = { end: () => call.end() };

      openStreams.add(stream);
      call.on('data', () => undefined);
      call.on('end', () => {
        openStreams.delete(stream);
        call.end();
      });
      call.on('error', () => openStreams.delete(stream));
    },
  });
  server.addService(serviceDefinition('grpc.health.v1.Health'), {
    Check: (_call: ServerUnaryCall<unknown, unknown>, callback: sendUnaryData<unknown>) =>
      callback(null, { status: 1 }),
  });

  const address = await bind(server, target, credentials);

  stdout(
    protocolLine({
      appVersion: version,
      network: target.network,
      address,
      serverCertificate: serverCert?.handshakeValue ?? '',
    }),
  );
  options.logger.log('debug', 'plugin server listening', { network: target.network, address, mtls: !!serverCert });

  return { done, address, stop };
}
