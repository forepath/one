import * as net from 'node:net';

import { FrameConnection } from './connection';
import { MICROVM_EXEC_BRIDGE_FAILURE_EXIT_CODE } from './constants';
import { ExecClientArguments } from './exec-command';
import { DataChannel, FrameType, decodeData, decodeJson, encodeResize } from './frame';
import { ForwardableSignal, parseErrorMessage, parseExecExit } from './messages';

const CLIENT_STREAM = 1;

export interface ExecClientIo {
  stdin: NodeJS.ReadableStream & { isTTY?: boolean; setRawMode?: (mode: boolean) => unknown };
  stdout: NodeJS.WritableStream & { isTTY?: boolean; columns?: number; rows?: number };
  stderr: NodeJS.WritableStream;
  env: NodeJS.ProcessEnv;
  /** Registers a handler for forwarded signals and terminal resizes; returns an unsubscribe function. */
  onSignal: (handler: (signal: ForwardableSignal) => void) => () => void;
}

/**
 * `vm-exec`: runs one command inside the guest through the launcher daemon and mirrors `docker exec` semantics
 * (streams, TTY, resize, signals, exit status). Resolves with the exit status to use for the process.
 */
export function runExecClient(socket: net.Socket, args: ExecClientArguments, io: ExecClientIo): Promise<number> {
  const tty = Boolean(io.stdin.isTTY && io.stdout.isTTY);
  const env = args.passEnv
    .filter((name) => io.env[name] !== undefined)
    .map((name) => `${name}=${io.env[name] as string}`);

  return new Promise<number>((resolve) => {
    let settled = false;
    let exitCode: number | null = null;
    const pendingWrites = new Set<Promise<void>>();

    const finish = (code: number): void => {
      if (settled) {
        return;
      }

      settled = true;
      unsubscribe();

      if (tty) {
        io.stdin.setRawMode?.(false);
      }

      io.stdin.pause();
      void Promise.all([...pendingWrites]).then(() => {
        socket.end();
        resolve(code);
      });
    };

    const fail = (message: string): void => {
      io.stderr.write(`vm-exec: ${message}\n`);
      finish(MICROVM_EXEC_BRIDGE_FAILURE_EXIT_CODE);
    };

    const connection = new FrameConnection({
      write: (bytes) => {
        if (!socket.destroyed) {
          socket.write(bytes);
        }
      },
      onFrame: (frame) => {
        if (frame.stream !== CLIENT_STREAM) {
          return;
        }

        switch (frame.type) {
          case FrameType.Data: {
            const { channel, data } = decodeData(frame.payload);
            const target = channel === DataChannel.Stderr ? io.stderr : io.stdout;
            const written = new Promise<void>((done) => target.write(data, () => done()));

            pendingWrites.add(written);
            void written.then(() => {
              pendingWrites.delete(written);
              connection.grant(CLIENT_STREAM, data.length);
            });
            break;
          }

          case FrameType.Exit:
            exitCode = parseExecExit(decodeJson(frame.payload)).code;
            break;
          case FrameType.Error:
            fail(parseErrorMessage(safeJson(frame.payload)));
            break;
          case FrameType.Close:
            if (exitCode === null) {
              fail('the session ended without an exit status');
            } else {
              finish(exitCode);
            }

            break;
          default:
            break;
        }
      },
      onProtocolError: (error) => fail(`bridge protocol error: ${error.message}`),
    });

    const unsubscribe = io.onSignal((signal) => {
      if (signal === 'SIGWINCH') {
        connection.send(FrameType.Resize, CLIENT_STREAM, encodeResize(io.stdout.columns ?? 80, io.stdout.rows ?? 24));
      } else {
        connection.send(FrameType.Signal, CLIENT_STREAM, Buffer.from(signal));
      }
    });

    socket.on('data', (chunk: Buffer) => connection.receive(chunk));
    socket.on('error', (error) => fail(`cannot reach the microVM bridge: ${error.message}`));
    socket.on('close', () => {
      if (exitCode !== null) {
        finish(exitCode);
      } else {
        fail('the microVM bridge closed the session');
      }
    });

    connection.openOutbound(CLIENT_STREAM);
    connection.sendJson(FrameType.OpenExec, CLIENT_STREAM, {
      argv: args.argv,
      env,
      user: args.user,
      workdir: args.workdir,
      tty,
      cols: io.stdout.columns ?? 80,
      rows: io.stdout.rows ?? 24,
    });

    if (tty) {
      io.stdin.setRawMode?.(true);
    }

    io.stdin.on('data', (chunk: Buffer | string) => {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);

      if (!connection.sendData(CLIENT_STREAM, DataChannel.Stdin, data)) {
        io.stdin.pause();
        connection.whenWritable(CLIENT_STREAM, () => {
          if (!settled) {
            io.stdin.resume();
          }
        });
      }
    });
    io.stdin.on('end', () =>
      connection.whenWritable(CLIENT_STREAM, () => connection.send(FrameType.Eof, CLIENT_STREAM, Buffer.from([0]))),
    );
    io.stdin.on('error', () => undefined);
  });
}

function safeJson(payload: Buffer): unknown {
  try {
    return decodeJson(payload);
  } catch {
    return null;
  }
}
