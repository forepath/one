import { Injectable, Logger } from '@nestjs/common';
import { Client } from 'ssh2';

export interface SshExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

/**
 * Executes a command on a remote host via SSH using key-based auth.
 * Used by the subscription item update scheduler.
 */
@Injectable()
export class SshExecutorService {
  private readonly logger = new Logger(SshExecutorService.name);

  async exec(
    host: string,
    port: number,
    username: string,
    privateKey: string,
    command: string,
  ): Promise<SshExecResult> {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      const chunks: Buffer[] = [];
      const errChunks: Buffer[] = [];

      conn
        .on('ready', () => {
          conn.exec(command, (err, stream) => {
            if (err) {
              conn.end();
              reject(err);

              return;
            }

            stream
              .on('close', (code: number | null) => {
                conn.end();
                resolve({
                  stdout: Buffer.concat(chunks).toString('utf8'),
                  stderr: Buffer.concat(errChunks).toString('utf8'),
                  code,
                });
              })
              .on('data', (data: Buffer) => chunks.push(data))
              .stderr.on('data', (data: Buffer) => errChunks.push(data));
          });
        })
        .on('error', (err) => reject(err))
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
