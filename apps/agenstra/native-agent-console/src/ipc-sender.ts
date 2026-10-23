/** What the main process knows about the frame that sent an IPC message. */
export interface IpcSenderInfo {
  /** URL of the sending frame (`event.senderFrame.url`); undefined when the frame is gone. */
  url: string | undefined;
  /** The frame is the top-level frame of its window (no iframe). */
  isTopFrame: boolean;
  /** The sender is the main window's web contents. */
  isMainWindow: boolean;
  /** The sender is the (data: URL) config dialog opened by the main process. */
  isConfigDialog: boolean;
}

/**
 * `window`: window controls (minimise / maximise / close) — any top frame of the app origin or the config dialog.
 * `privileged`: config URL, update channel, update check, config dialog — only the main window on the app origin
 * or the config dialog. Iframes, navigated-away pages and pop-ups on other origins are refused.
 */
export type IpcScope = 'window' | 'privileged';

export function appOrigin(port: number): string {
  return `http://localhost:${port}`;
}

function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;

  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

export function ipcSenderAllowed(scope: IpcScope, sender: IpcSenderInfo, trustedOrigin: string): boolean {
  if (!sender.isTopFrame) return false;

  if (sender.isConfigDialog) return !!sender.url?.startsWith('data:text/html');

  if (originOf(sender.url) !== trustedOrigin) return false;

  return scope === 'window' || sender.isMainWindow;
}
