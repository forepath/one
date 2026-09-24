/** Sync Storybook toolbar globals onto the preview document (stories + docs). */
export function applyFpcDocumentGlobals(globals: Record<string, unknown>): void {
  const theme = String(globals['theme'] ?? 'light');
  const colorSet = String(globals['colorSet'] ?? 'bootstrap');

  document.documentElement.setAttribute('data-bs-theme', theme);

  if (colorSet === 'bootstrap') {
    document.documentElement.removeAttribute('data-fpc-brand');
  } else {
    document.documentElement.setAttribute('data-fpc-brand', colorSet);
  }
}
