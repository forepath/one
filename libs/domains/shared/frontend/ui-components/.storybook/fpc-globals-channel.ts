import { addons } from 'storybook/preview-api';
import { SET_GLOBALS, UPDATE_GLOBALS } from 'storybook/internal/core-events';

import { applyFpcDocumentGlobals } from './apply-document-globals';

type GlobalsMap = Record<string, unknown>;
type GlobalsListener = (globals: GlobalsMap) => void;

const DEFAULT_GLOBALS: GlobalsMap = { theme: 'light', colorSet: 'bootstrap' };

/** Storybook encodes toolbar globals as `globals=theme:dark;colorSet:decabill` in the preview URL. */
export function readGlobalsFromUrl(): GlobalsMap {
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

/**
 * Keep a preview-iframe mirror of toolbar globals and write them to `documentElement`.
 *
 * Listen to the manager intent (`UPDATE_GLOBALS`) and the initial dump (`SET_GLOBALS`) —
 * not `GLOBALS_UPDATED`, which can arrive with a stale snapshot relative to the toolbar click.
 * Runs for canvas and MDX docs (docs never hit story decorators).
 */
let previewGlobals: GlobalsMap = { ...DEFAULT_GLOBALS, ...readGlobalsFromUrl() };
const listeners = new Set<GlobalsListener>();

export function getPreviewGlobals(): GlobalsMap {
  return previewGlobals;
}

/** Subscribe to toolbar global commits (docs container Storybook theme, etc.). */
export function subscribePreviewGlobals(listener: GlobalsListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function commitGlobals(patch: GlobalsMap, replace = false): void {
  previewGlobals = replace ? { ...DEFAULT_GLOBALS, ...patch } : { ...previewGlobals, ...patch };
  applyFpcDocumentGlobals(previewGlobals);
  for (const listener of listeners) {
    listener(previewGlobals);
  }
}

export function installFpcGlobalsChannel(): void {
  applyFpcDocumentGlobals(previewGlobals);

  const channel = addons.getChannel();

  channel.on(SET_GLOBALS, (payload: { globals?: GlobalsMap }) => {
    if (payload?.globals) {
      commitGlobals(payload.globals, true);
    }
  });

  channel.on(UPDATE_GLOBALS, (payload: { globals?: GlobalsMap }) => {
    if (payload?.globals) {
      commitGlobals(payload.globals, false);
    }
  });
}
