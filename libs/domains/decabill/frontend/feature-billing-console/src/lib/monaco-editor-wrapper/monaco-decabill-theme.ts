import * as monaco from 'monaco-editor';

export const MONACO_THEME_LIGHT = 'decabill-vs';
export const MONACO_THEME_DARK = 'decabill-vs-dark';

export function syncDecabillMonacoThemes(): void {
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

export function applyDecabillMonacoEditorTheme(isDarkMode: boolean): void {
  syncDecabillMonacoThemes();
  monaco.editor.setTheme(isDarkMode ? MONACO_THEME_DARK : MONACO_THEME_LIGHT);
}
