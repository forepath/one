/** What the main process knows about the frame that sent an IPC message. */
export interface IpcSenderInfo {
  /** URL of the sending frame (`event.senderFrame.url`); undefined when the frame is gone. */
  url: string | undefined;
  /** The frame is the top-level frame of its window (no iframe). */
  isTopFrame: boolean;
  /** The sender is the web contents the scope belongs to (a title bar view, a console view, the settings window). */
  fromExpectedView: boolean;
}

/**
 * `titlebar`: window buttons and the settings gear — only a title bar view showing its bundled `titlebar.html`.
 * `settings`: read and change the settings — only the settings window showing its bundled `settings.html`.
 * `console`: theme reports of the console page — only a console view's top frame on the app origin.
 * Iframes, pages of other origins and the bundled pages of another scope are refused.
 */
export type IpcScope = 'titlebar' | 'settings' | 'console';

const RENDERER_PAGES: Record<Exclude<IpcScope, 'console'>, string> = {
  titlebar: 'titlebar.html',
  settings: 'settings.html',
};

export function appOrigin(port: number): string {
  return `http://localhost:${port}`;
}

export function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;

  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/** A bundled page of the app (`file://…/renderer/<page>`, query and hash ignored). */
export function isRendererPage(url: string | undefined, page: string): boolean {
  if (!url) return false;

  try {
    const parsed = new URL(url);

    return parsed.protocol === 'file:' && parsed.pathname.endsWith(`/renderer/${page}`);
  } catch {
    return false;
  }
}

export function ipcSenderAllowed(scope: IpcScope, sender: IpcSenderInfo, trustedOrigin: string): boolean {
  if (!sender.fromExpectedView || !sender.isTopFrame) return false;

  if (scope === 'console') return originOf(sender.url) === trustedOrigin;

  return isRendererPage(sender.url, RENDERER_PAGES[scope]);
}

/** Pages of the local console: they open in an app window (pop-ups included). */
export function isAppUrl(url: string | undefined, trustedOrigin: string): boolean {
  return !!trustedOrigin && originOf(url) === trustedOrigin;
}

/** Links that may be handed to the system browser (never file:, javascript: and the like). */
export function isExternalLink(url: string): boolean {
  try {
    const { protocol } = new URL(url);

    return protocol === 'https:' || protocol === 'http:' || protocol === 'mailto:';
  } catch {
    return false;
  }
}

/**
 * The server URL as entered in the settings: '' resets it, otherwise it must be an http(s) URL. Returns undefined for
 * anything else (the settings page shows the same rule before it sends).
 */
export function parseConfigUrl(value: unknown): string | undefined {
  if (value === null || value === undefined) return '';

  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();

  if (!trimmed) return '';

  try {
    const { protocol } = new URL(trimmed);

    return protocol === 'https:' || protocol === 'http:' ? trimmed : undefined;
  } catch {
    return undefined;
  }
}
