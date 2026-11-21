/**
 * Preload of the console view. The console page gets no API: the window buttons and the settings live in the title
 * bar view above it. This only reports the page theme (`data-bs-theme` on <html>, set by the console's theme service),
 * so the title bar and the settings follow it; the main process accepts it only from the app origin.
 */
import { ipcRenderer } from 'electron';

let reported: string | undefined;

function reportTheme(): void {
  const theme = document.documentElement?.getAttribute('data-bs-theme');

  if ((theme === 'light' || theme === 'dark') && theme !== reported) {
    reported = theme;
    ipcRenderer.send('console:theme', theme);
  }
}

function watchTheme(): void {
  if (!document.documentElement) return;

  new MutationObserver(reportTheme).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-bs-theme'],
  });
  reportTheme();
}

if (document.documentElement) watchTheme();
else document.addEventListener('readystatechange', watchTheme, { once: true });
