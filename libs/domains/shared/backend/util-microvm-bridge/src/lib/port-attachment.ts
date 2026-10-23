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
