import { create, themes, type ThemeVars } from 'storybook/theming';

/** Brand primary hex values (same as styles/brands/<brand>/palette). Bootstrap = stock BS primary. */
export const FPC_BRAND_PRIMARY: Record<string, string> = {
  bootstrap: '#0d6efd',
  decabill: '#32a852',
  agenstra: '#7a3fff',
  forepath: '#ff6b35',
};

export function fpcBrandPrimary(colorSet: unknown): string {
  const key = String(colorSet ?? 'bootstrap');
  return FPC_BRAND_PRIMARY[key] ?? FPC_BRAND_PRIMARY['bootstrap'];
}

/**
 * Storybook light/dark base with accent swapped to the Color set primary.
 * colorSecondary drives icons, active sidebar/docs markers, and selected bars
 * (Storybook default is #479dff / rgb(71, 157, 255)).
 */
export function createFpcStorybookTheme(mode: unknown, colorSet: unknown): ThemeVars {
  const base = String(mode) === 'dark' ? themes.dark : themes.light;
  const accent = fpcBrandPrimary(colorSet);

  return create({
    ...base,
    colorPrimary: accent,
    colorSecondary: accent,
    barSelectedColor: accent,
    barHoverColor: accent,
  });
}
