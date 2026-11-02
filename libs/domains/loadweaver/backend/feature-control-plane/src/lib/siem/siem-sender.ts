import { createSocket } from 'node:dgram';
import { connect as netConnect, type Socket } from 'node:net';
import { connect as tlsConnect } from 'node:tls';

import { syslogFrame } from './siem-formats';

const TIMEOUT_MS = 10_000;
const MAX_DATAGRAM = 8_000;

/** A datagram of at most 8,000 bytes, cut on a character boundary. */
export function udpPayload(message: string): Buffer {
  const bytes = Buffer.from(message, 'utf8');

  if (bytes.length <= MAX_DATAGRAM) return bytes;

  let end = MAX_DATAGRAM;

  // Back up over UTF-8 continuation bytes (10xxxxxx).
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;

  return bytes.subarray(0, end);
}

/** Sends syslog messages: one datagram each over UDP, octet-counted frames over TCP / TLS (verified certificate). */
export async function sendSyslog(url: URL, messages: readonly string[]): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const port = Number(url.port);

  if (url.protocol === 'udp:') {
    const socket = createSocket(host.includes(':') ? 'udp6' : 'udp4');

    try {
      for (const message of messages)
        await new Promise<void>((resolve, reject) =>
          socket.send(udpPayload(message), port, host, (error) => (error ? reject(error) : resolve())),
        );
    } finally {
      socket.close();
    }

    return;
  }

  await new Promise<void>((resolve, reject) => {
    const onConnect = () => socket.end(messages.map(syslogFrame).join(''), () => resolve());
    const socket: Socket =
      url.protocol === 'tls:'
        ? tlsConnect({ host, port, servername: host.includes(':') ? undefined : host }, onConnect)
        : netConnect({ host, port }, onConnect);

    socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error('syslog connection timed out')));
    socket.on('error', reject);
  });
}

/** POSTs JSON; anything but 2xx is a failure (the batch is retried). */
export async function sendJson(url: string, body: unknown, headers: Record<string, string>): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  await response.body?.cancel().catch(() => undefined);

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}
