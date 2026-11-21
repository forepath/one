/**
 * Product identity of this desktop app. The bundled pages (`renderer/`: splash, title bar, settings) take their colours
 * from `renderer/brand.css`; the values here are the same tokens for the native window backgrounds, so nothing flashes
 * in another colour before a page paints. Both follow the console's palette (`ui-components/styles/brands/agenstra`).
 */
export const APP_NAME = 'Agenstra Agent Console';

export type Theme = 'light' | 'dark';

export function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark';
}

/** The console page background (`--bs-body-bg`). */
export const PAGE_BACKGROUND: Record<Theme, string> = { light: '#f2eff9', dark: '#0f0f11' };

/** The console chrome (`--bs-tertiary-bg`, as the sidebar): title bar, splash and settings. */
export const CHROME_BACKGROUND: Record<Theme, string> = { light: '#e8e4f0', dark: '#141417' };
