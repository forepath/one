/**
 * The guest's view of the launcher end of its virtio-serial port (M7 W10b). A read of the port returns end-of-file
 * while no launcher daemon is connected: at boot before the daemon connected (nothing to do, read again) and after
 * a live migration, when the target's daemon only connects once the microVM runs there. An end after the session was
 * established (or while a re-attach is still unanswered) means the agent must re-attach to a new daemon.
 */
export class PortAttachment {
  private established = false;
  private reattaching = false;

  constructor(private readonly onReattach: () => void) {}

  /** Data from the launcher arrived: the session (re-)established. */
  data(): void {
    this.established = true;
    this.reattaching = false;
  }

  /** The port reported end-of-file; returns whether the agent re-attached. */
  ended(): boolean {
    if (!this.established && !this.reattaching) {
      return false;
    }

    this.established = false;
    this.reattaching = true;
    this.onReattach();

    return true;
  }
}

/**
 * How the guest agent ends once the workload exited (combined gate G3): the port is read through libuv's thread pool,
 * so one pool thread is always blocked in `read()` on the virtio-serial port. `process.exit()` runs libuv's library
 * destructor, which joins the pool threads, and never returns — the guest never powered off and the launcher never
 * exited. So: no further port reads, flush the output (the `WORKLOAD_EXIT` frame is in it), then end the process with
 * SIGKILL. The launcher takes the workload's status from the frame; the agent's own status is only logged by the init.
 */
export function endAfterWorkloadExit(io: {
  stopReading: () => void;
  flush: (done: () => void) => void;
  kill: () => void;
  setTimer: (run: () => void, ms: number) => void;
}): void {
  let ended = false;
  const end = () => {
    if (ended) return;

    ended = true;
    io.kill();
  };

  io.stopReading();
  io.flush(end);
  // A flush that never completes (the launcher stopped reading) must not keep the guest up.
  io.setTimer(end, 2000);
}

/**
 * The guest's writer to the bridge port. Frames that arrive after the port stream was ended (after the workload exit:
 * a killed exec session reporting its exit, G5 2026-10-28) are dropped, and stream errors are logged: an unhandled
 * `'error'` ("write after end") crashed the agent, and a crashing agent exits through libuv, which joins the blocked
 * port reader — the guest never powered off and the container never ended.
 */
export function portWriter(
  output: {
    readonly writableEnded: boolean;
    write: (bytes: Buffer) => unknown;
    on: (event: 'error', listener: (error: Error) => void) => unknown;
  },
  log: (message: string) => void,
): (bytes: Buffer) => void {
  output.on('error', (error) => log(`bridge port write: ${error.message}`));

  return (bytes) => {
    if (output.writableEnded) return;

    output.write(bytes);
  };
}
