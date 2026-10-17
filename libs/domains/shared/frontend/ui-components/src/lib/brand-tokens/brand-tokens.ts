/**
 * Resolved brand colours for canvas / third-party renderers (Cytoscape, xterm.js, Monaco) that
 * cannot consume `var(--bs-*)` directly. Values are `#rrggbb` hex strings read from the document's
 * computed Bootstrap variables, so they follow the active brand (`data-fpc-brand`) and colour mode
 * (`data-bs-theme`). Re-read them via `fpcObserveBrandChanges` when either attribute changes.
 */
export interface FpcBrandPalette {
  isDark: boolean;
  primary: string;
  secondary: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  bodyColor: string;
  bodyBg: string;
  secondaryColor: string;
  borderColor: string;
  tertiaryBg: string;
  fontFamily: string;
  monospaceFontFamily: string;
}

const LIGHT_FALLBACK: FpcBrandPalette = {
  isDark: false,
  primary: '#0d6efd',
  secondary: '#6c757d',
  success: '#198754',
  warning: '#ffc107',
  danger: '#dc3545',
  info: '#0dcaf0',
  bodyColor: '#212529',
  bodyBg: '#ffffff',
  secondaryColor: '#6c757d',
  borderColor: '#dee2e6',
  tertiaryBg: '#f8f9fa',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  monospaceFontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
};

const DARK_FALLBACK: FpcBrandPalette = {
  ...LIGHT_FALLBACK,
  isDark: true,
  bodyColor: '#dee2e6',
  bodyBg: '#212529',
  secondaryColor: '#adb5bd',
  borderColor: '#495057',
  tertiaryBg: '#2b3035',
};

/** Attributes on `<html>` / `<body>` that switch brand palette or colour mode. */
export const FPC_BRAND_ATTRIBUTES = ['data-bs-theme', 'data-fpc-brand'] as const;

function getDocument(doc?: Document | null): Document | null {
  if (doc) {
    return doc;
  }

  return typeof document === 'undefined' ? null : document;
}

/** Whether the document is in Bootstrap dark mode (`data-bs-theme="dark"` on `<html>` or `<body>`). */
export function fpcIsDarkTheme(doc?: Document | null): boolean {
  const target = getDocument(doc);

  if (!target) {
    return false;
  }

  const theme =
    target.body?.getAttribute('data-bs-theme') ?? target.documentElement.getAttribute('data-bs-theme') ?? 'light';

  return theme === 'dark';
}

function channel(value: number): string {
  const clamped = Math.max(0, Math.min(255, Math.round(value)));

  return clamped.toString(16).padStart(2, '0');
}

/**
 * Normalises a CSS colour (`#rgb`, `#rrggbb`, `rgb()`, `rgba()`, `color(srgb …)`) to `#rrggbb`.
 * Returns `null` for values it cannot parse (e.g. unresolved `color-mix()` in a test DOM).
 */
export function fpcToHexColor(value: string | null | undefined): string | null {
  const input = (value ?? '').trim().toLowerCase();

  if (!input) {
    return null;
  }

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/.exec(input);

  if (hex) {
    const digits = hex[1];

    return digits.length === 3
      ? `#${digits
          .split('')
          .map((digit) => digit + digit)
          .join('')}`
      : `#${digits}`;
  }

  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(input);

  if (rgb) {
    return `#${channel(Number(rgb[1]))}${channel(Number(rgb[2]))}${channel(Number(rgb[3]))}`;
  }

  const srgb = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(input);

  if (srgb) {
    return `#${channel(Number(srgb[1]) * 255)}${channel(Number(srgb[2]) * 255)}${channel(Number(srgb[3]) * 255)}`;
  }

  return null;
}

/** Lets the browser resolve a colour expression (e.g. `color-mix()`) through a probe element. */
function resolveThroughProbe(doc: Document, raw: string): string | null {
  const host = doc.body ?? doc.documentElement;

  if (!host || typeof getComputedStyle === 'undefined') {
    return null;
  }

  const probe = doc.createElement('span');

  probe.style.display = 'none';
  probe.style.color = raw;
  host.appendChild(probe);

  const resolved = getComputedStyle(probe).color;

  probe.remove();

  return fpcToHexColor(resolved);
}

/** Reads one `--bs-*` colour variable as `#rrggbb`, or `fallback` when it is missing / unparsable. */
export function fpcReadCssColor(name: string, fallback: string, doc?: Document | null): string {
  const target = getDocument(doc);

  if (!target || typeof getComputedStyle === 'undefined') {
    return fallback;
  }

  const raw = getComputedStyle(target.documentElement).getPropertyValue(name).trim();

  if (!raw) {
    return fallback;
  }

  return fpcToHexColor(raw) ?? resolveThroughProbe(target, raw) ?? fallback;
}

function readCssString(name: string, fallback: string, doc: Document | null): string {
  if (!doc || typeof getComputedStyle === 'undefined') {
    return fallback;
  }

  const raw = getComputedStyle(doc.documentElement).getPropertyValue(name).trim();

  return raw || fallback;
}

/** Snapshot of the active brand palette (see {@link FpcBrandPalette}). */
export function fpcReadBrandPalette(doc?: Document | null): FpcBrandPalette {
  const target = getDocument(doc);
  const isDark = fpcIsDarkTheme(target);
  const fallback = isDark ? DARK_FALLBACK : LIGHT_FALLBACK;
  const color = (name: string, value: string) => fpcReadCssColor(name, value, target);

  return {
    isDark,
    primary: color('--bs-primary', fallback.primary),
    secondary: color('--bs-secondary', fallback.secondary),
    success: color('--bs-success', fallback.success),
    warning: color('--bs-warning', fallback.warning),
    danger: color('--bs-danger', fallback.danger),
    info: color('--bs-info', fallback.info),
    bodyColor: color('--bs-body-color', fallback.bodyColor),
    bodyBg: color('--bs-body-bg', fallback.bodyBg),
    secondaryColor: color('--bs-secondary-color', fallback.secondaryColor),
    borderColor: color('--bs-border-color', fallback.borderColor),
    tertiaryBg: color('--bs-tertiary-bg', fallback.tertiaryBg),
    fontFamily: readCssString('--bs-body-font-family', fallback.fontFamily, target),
    monospaceFontFamily: readCssString('--bs-font-monospace', fallback.monospaceFontFamily, target),
  };
}

/** `#rrggbb` plus an alpha byte (`#rrggbbaa`), for renderers that accept 8-digit hex. */
export function fpcWithAlpha(hex: string, alpha: number): string {
  return `${hex.slice(0, 7)}${channel(alpha * 255)}`;
}

/**
 * Calls `callback` whenever the brand or colour mode attributes change on `<html>` or `<body>`.
 * Returns a disposer. No-op outside the browser.
 */
export function fpcObserveBrandChanges(callback: () => void, doc?: Document | null): () => void {
  const target = getDocument(doc);

  if (!target || typeof MutationObserver === 'undefined') {
    return () => undefined;
  }

  const observer = new MutationObserver(() => callback());
  const options: MutationObserverInit = { attributes: true, attributeFilter: [...FPC_BRAND_ATTRIBUTES] };

  observer.observe(target.documentElement, options);

  if (target.body) {
    observer.observe(target.body, options);
  }

  return () => observer.disconnect();
}
