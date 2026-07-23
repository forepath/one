/**
 * Map a pointer event on a canvas to CDP mouse coordinates using screencast metadata.
 */
export function mapCanvasPointerToDeviceCoordinates(options: {
  clientX: number;
  clientY: number;
  canvasRect: { left: number; top: number; width: number; height: number };
  deviceWidth: number;
  deviceHeight: number;
}): { x: number; y: number } {
  const { clientX, clientY, canvasRect, deviceWidth, deviceHeight } = options;
  const relativeX = canvasRect.width > 0 ? (clientX - canvasRect.left) / canvasRect.width : 0;
  const relativeY = canvasRect.height > 0 ? (clientY - canvasRect.top) / canvasRect.height : 0;
  const x = Math.max(0, Math.min(deviceWidth, relativeX * deviceWidth));
  const y = Math.max(0, Math.min(deviceHeight, relativeY * deviceHeight));

  return { x, y };
}

export function mapDomMouseButton(button: number): 'none' | 'left' | 'middle' | 'right' {
  switch (button) {
    case 0:
      return 'left';
    case 1:
      return 'middle';
    case 2:
      return 'right';
    default:
      return 'none';
  }
}

export type CdpKeyEventPayload = {
  type: 'keyDown' | 'keyUp' | 'rawKeyDown' | 'char';
  text?: string;
  unmodifiedText?: string;
  key?: string;
  code?: string;
  windowsVirtualKeyCode?: number;
  nativeVirtualKeyCode?: number;
  modifiers?: number;
};

export function mapDomModifiers(event: {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): number {
  return (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0);
}

/**
 * Map a DOM keyboard event to one or more CDP Input.dispatchKeyEvent payloads.
 * Enter/Tab and printable characters need a follow-up `char` event for Chromium to accept them.
 */
export function mapDomKeyboardEventToCdpKeyEvents(
  event: {
    key: string;
    code: string;
    keyCode: number;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
  },
  phase: 'keyDown' | 'keyUp',
): CdpKeyEventPayload[] {
  const modifiers = mapDomModifiers(event);
  const windowsVirtualKeyCode = event.keyCode || 0;
  const base = {
    key: event.key,
    code: event.code,
    windowsVirtualKeyCode,
    nativeVirtualKeyCode: windowsVirtualKeyCode,
    modifiers,
  };

  if (phase === 'keyUp') {
    return [{ ...base, type: 'keyUp' as const }];
  }

  const events: CdpKeyEventPayload[] = [{ ...base, type: 'rawKeyDown' }];
  let text: string | undefined;

  if (event.key === 'Enter') {
    text = '\r';
  } else if (event.key === 'Tab') {
    text = '\t';
  } else if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
    text = event.key;
  }

  if (text !== undefined) {
    events.push({
      type: 'char',
      text,
      unmodifiedText: text,
      key: event.key,
      code: event.code,
      windowsVirtualKeyCode,
      nativeVirtualKeyCode: windowsVirtualKeyCode,
      modifiers,
    });
  }

  return events;
}

/**
 * Normalize a user-typed address-bar value into an absolute http(s) URL, or null if invalid.
 */
export function normalizeBrowserPreviewNavigateUrl(raw: string): string | null {
  const trimmed = raw.trim();

  if (!trimmed || trimmed.length > 2048) {
    return null;
  }

  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(withScheme);

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

/**
 * True when Preview is on a blank start page (guide overlay should show).
 */
export function isBrowserPreviewBlankUrl(url: string | null | undefined): boolean {
  if (url == null) {
    return false;
  }

  const trimmed = url.trim().toLowerCase();

  return trimmed === 'about:blank' || trimmed.startsWith('about:blank#') || trimmed.startsWith('about:blank?');
}
