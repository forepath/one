import type { Stream } from '@agentclientprotocol/sdk';

/**
 * Bidirectional newline-delimited JSON-RPC transport to an agent subprocess.
 */
export interface AcpTransport {
  readonly stream: Stream;
  close(): Promise<void>;
}

export interface AcpTransportFactory {
  connect(containerId: string, launchSpec: { executable: string; args: string[] }): Promise<AcpTransport>;
}
