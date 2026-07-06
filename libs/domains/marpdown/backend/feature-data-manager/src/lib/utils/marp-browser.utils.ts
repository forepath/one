import { chromium } from 'playwright';

export function resolveMarpBrowserPath(): string | undefined {
  try {
    return chromium.executablePath();
  } catch {
    const fromEnv = process.env['BROWSER_PATH'] ?? process.env['CHROME_PATH'];

    return fromEnv?.trim() ? fromEnv : undefined;
  }
}
