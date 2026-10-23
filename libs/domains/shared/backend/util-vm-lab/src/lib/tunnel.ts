import { spawn } from 'node:child_process';
import { type AddressInfo, createServer, type Server, type Socket } from 'node:net';

import { hostDockerEnv } from './process';

/**
 * Stdio tunnels from the test process into a lab VM: every connection to a local listener becomes one child process
 * (`docker exec -i … ssh … <remote command>`) whose stdin / stdout carry the bytes. Nothing is published on the lab
 * host (Docker Desktop on WSL2 can't reach published loopback ports reliably), listeners are unix sockets in a
 * per-run directory or TCP on 127.0.0.1 with an ephemeral port, so nothing clashes with the user's containers.
 */

export interface Tunnel {
  /** `unix:<path>` or `127.0.0.1:<port>`. */
  readonly address: string;
  close(): void;
}

/** Arguments of `docker …` that run `remote` in the guest with its stdio attached. */
export type RemoteCommand = (remote: string) => string[];

function listen(server: Server, target: string | number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.once('error', reject);

    if (typeof target === 'string') server.listen(target, () => resolve());
    else server.listen(target, '127.0.0.1', () => resolve());
  });
}

function tunnelServer(command: RemoteCommand, remote: string): { server: Server; connections: Set<Socket> } {
  const connections = new Set<Socket>();
  // Half-open: Docker clients close their write side after sending and keep reading the output.
  const server = createServer({ allowHalfOpen: true }, (connection) => {
    const child = spawn('docker', command(remote), { env: hostDockerEnv(), stdio: ['pipe', 'pipe', 'ignore'] });

    connections.add(connection);
    connection.pipe(child.stdin);
    // The socket ends once the child's output is fully drained (not on process exit).
    child.stdout.pipe(connection);
    connection.on('close', () => {
      connections.delete(connection);
      child.kill('SIGTERM');
    });
    connection.on('error', () => child.kill('SIGTERM'));
    child.on('error', () => connection.destroy());
    child.stdin.on('error', () => connection.destroy());
  });

  return { server, connections };
}

function closer(server: Server, connections: Set<Socket>): () => void {
  return () => {
    // Open streams (logs, attach, exec) must not keep the tunnel (and the run) alive.
    for (const connection of connections) connection.destroy();

    server.close();
  };
}

/**
 * A local unix socket bridged to the guest's Docker API: every connection becomes a `docker system dial-stdio`
 * session in the guest (the Docker CLI's own stdio proxy to the daemon socket).
 */
export async function openDockerSocketTunnel(command: RemoteCommand, socketPath: string): Promise<Tunnel> {
  const { server, connections } = tunnelServer(command, 'docker system dial-stdio');

  await listen(server, socketPath);

  return { address: `unix:${socketPath}`, close: closer(server, connections) };
}

/**
 * A local TCP port (127.0.0.1, ephemeral) forwarded to `host:port` as seen from the guest (`127.0.0.1:3400` = the
 * control-plane API on a member). Uses bash's `/dev/tcp` in the guest (no extra tools).
 */
export async function openTcpTunnel(command: RemoteCommand, host: string, port: number): Promise<Tunnel> {
  if (!/^[A-Za-z0-9.:-]+$/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error(`invalid tunnel target ${host}:${port}`);

  const remote = `bash -c 'exec 3<>/dev/tcp/${host}/${port}; cat <&3 & cat >&3; wait'`;
  const { server, connections } = tunnelServer(command, remote);

  await listen(server, 0);

  return { address: `127.0.0.1:${(server.address() as AddressInfo).port}`, close: closer(server, connections) };
}
