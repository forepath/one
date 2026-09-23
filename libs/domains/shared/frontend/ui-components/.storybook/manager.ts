import { addons } from 'storybook/manager-api';
import { SET_GLOBALS, UPDATE_GLOBALS } from 'storybook/internal/core-events';

import { createFpcStorybookTheme } from './fpc-storybook-theme';

type GlobalsMap = Record<string, unknown>;

function readGlobalsFromUrl(): GlobalsMap {
  const raw = new URLSearchParams(window.location.search).get('globals');
  if (!raw) {
    return {};
  }

  const parsed: GlobalsMap = {};
  for (const part of raw.split(';')) {
    const sep = part.indexOf(':');
    if (sep <= 0) {
      continue;
    }
    parsed[part.slice(0, sep)] = decodeURIComponent(part.slice(sep + 1));
  }
  return parsed;
}

let themeMode: unknown = 'light';
let colorSet: unknown = 'bootstrap';

function applyManagerTheme(): void {
  addons.setConfig({
    theme: createFpcStorybookTheme(themeMode, colorSet),
  });
}

function patchFrom(globals: GlobalsMap | undefined): void {
  if (!globals) {
    return;
  }
  if (globals['theme'] != null) {
    themeMode = globals['theme'];
  }
  if (globals['colorSet'] != null) {
    colorSet = globals['colorSet'];
  }
  applyManagerTheme();
}

const fromUrl = readGlobalsFromUrl();
themeMode = fromUrl['theme'] ?? themeMode;
colorSet = fromUrl['colorSet'] ?? colorSet;
applyManagerTheme();

addons.register('fpc/brand-theme', () => {
  const channel = addons.getChannel();

  channel.on(SET_GLOBALS, (payload: { globals?: GlobalsMap }) => {
    patchFrom(payload?.globals);
  });

  channel.on(UPDATE_GLOBALS, (payload: { globals?: GlobalsMap }) => {
    patchFrom(payload?.globals);
  });
});
