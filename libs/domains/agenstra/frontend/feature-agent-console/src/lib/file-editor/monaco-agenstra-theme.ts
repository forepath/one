import * as monaco from 'monaco-editor';

export const MONACO_THEME_LIGHT = 'agenstra-vs';
export const MONACO_THEME_DARK = 'agenstra-vs-dark';

/**
 * Registers light/dark themes that inherit built-in `vs` / `vs-dark` (for future color tweaks).
 */
export function syncAgenstraMonacoThemes(): void {
  monaco.editor.defineTheme(MONACO_THEME_LIGHT, {
    base: 'vs',
    inherit: true,
    rules: [],
    colors: {},
  });
  monaco.editor.defineTheme(MONACO_THEME_DARK, {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {},
  });
}

export function applyAgenstraMonacoEditorTheme(isDarkMode: boolean): void {
  syncAgenstraMonacoThemes();
  monaco.editor.setTheme(isDarkMode ? MONACO_THEME_DARK : MONACO_THEME_LIGHT);
}
