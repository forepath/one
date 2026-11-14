import { Injectable, Logger } from '@nestjs/common';
import { Client } from 'ssh2';

import { waitForTcpPort } from '../utils/wait-for-tcp-port.util';

export interface SshExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export interface SshExecOptions {
  /** Hard stop for the remote command (ms). Connection readyTimeout stays separate. */
  commandTimeoutMs?: number;
}

const DEFAULT_SSH_READY_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Executes a command on a remote host via SSH using key-based auth.
 * Used by the subscription item update scheduler and mid-life addon scripts.
 */
@Injectable()
export class SshExecutorService {
  private readonly logger = new Logger(SshExecutorService.name);

  /**
   * Waits until the host accepts TCP connections on the SSH port (sshd after reboot/resize).
   */
  async waitUntilReachable(host: string, port: number, options?: { timeoutMs?: number }): Promise<void> {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_SSH_READY_TIMEOUT_MS;

    try {
      await waitForTcpPort(host, port, { timeoutMs });
      this.logger.log(`SSH endpoint ${host}:${port} is reachable`);
    } catch {
      throw new Error(`Timed out waiting for SSH on ${host}:${port} after ${timeoutMs}ms`);
    }
  }

  async exec(
    host: string,
    port: number,
    username: string,
    privateKey: string,
    command: string,
    options?: SshExecOptions,
  ): Promise<SshExecResult> {
    const commandTimeoutMs = options?.commandTimeoutMs;

    return new Promise((resolve, reject) => {
      const conn = new Client();
      const chunks: Buffer[] = [];
      const errChunks: Buffer[] = [];
      let settled = false;
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const settle = (fn: () => void): void => {
        if (settled) {
          return;
        }

        settled = true;

        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }

        fn();
      };

      if (commandTimeoutMs !== undefined && commandTimeoutMs > 0) {
        timeoutHandle = setTimeout(() => {
          settle(() => {
            conn.end();
            reject(new Error(`SSH command timed out after ${commandTimeoutMs}ms`));
          });
        }, commandTimeoutMs);
      }

      conn
        .on('ready', () => {
          conn.exec(command, (err, stream) => {
            if (err) {
              settle(() => {
                conn.end();
                reject(err);
              });

              return;
            }

            stream
              .on('close', (code: number | null) => {
                settle(() => {
                  conn.end();
                  resolve({
                    stdout: Buffer.concat(chunks).toString('utf8'),
                    stderr: Buffer.concat(errChunks).toString('utf8'),
                    code,
                  });
                });
              })
              .on('data', (data: Buffer) => chunks.push(data))
              .stderr.on('data', (data: Buffer) => errChunks.push(data));
          });
        })
        .on('error', (err) => {
          settle(() => reject(err));
        })
        .connect({
          host,
          port,
          username,
          privateKey,
          readyTimeout: 15000,
        });
    });
  }
}
