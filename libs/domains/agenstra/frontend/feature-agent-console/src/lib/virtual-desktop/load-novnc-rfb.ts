/** Runtime loader for untyped `@novnc/novnc` (no published typings). */

export type NovncRfbInstance = {
  scaleViewport: boolean;
  resizeSession: boolean;
  clipViewport: boolean;
  disconnect(): void;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
};

export type NovncRfbConstructor = new (
  target: HTMLElement,
  urlOrChannel: string | WebSocket,
  options?: {
    shared?: boolean;
    credentials?: { password?: string; username?: string; target?: string };
    repeaterID?: string;
    wsProtocols?: string | string[];
  },
) => NovncRfbInstance;

export async function loadNovncRfb(): Promise<NovncRfbConstructor> {
  // Package ships JS only; keep a local constructor type instead of ambient augmentation.
  // @ts-expect-error TS7016 — @novnc/novnc has no declaration file
  const mod = await import('@novnc/novnc/lib/rfb.js');

  return (mod as { default: NovncRfbConstructor }).default;
}
