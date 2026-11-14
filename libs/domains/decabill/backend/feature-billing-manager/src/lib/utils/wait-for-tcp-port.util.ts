import { Socket } from 'net';

const DEFAULT_POLL_INTERVAL_MS = 3000;
const DEFAULT_CONNECT_TIMEOUT_MS = 3000;

export interface WaitForTcpPortOptions {
  timeoutMs: number;
  pollIntervalMs?: number;
  connectTimeoutMs?: number;
}

/**
 * Polls until `host:port` accepts a TCP connection (e.g. sshd after reboot / resize).
 */
export async function waitForTcpPort(host: string, port: number, options: WaitForTcpPortOptions): Promise<void> {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  const deadline = Date.now() + options.timeoutMs;

  while (Date.now() < deadline) {
    if (await isTcpPortOpen(host, port, connectTimeoutMs)) {
      return;
    }

    await delay(pollIntervalMs);
  }

  throw new Error(`Timed out waiting for ${host}:${port} after ${options.timeoutMs}ms`);
}

export function isTcpPortOpen(host: string, port: number, connectTimeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    let settled = false;
    const finish = (result: boolean): void => {
      if (settled) {
        return;
      }

      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(connectTimeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
