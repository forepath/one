import { createReducer, on } from '@ngrx/store';

import type { CreatedWallboardToken, KioskView, WallboardToken } from '../../types/wallboards.types';
import {
  clearCreatedWallboard,
  createWallboard,
  createWallboardFailure,
  createWallboardSuccess,
  loadKiosk,
  loadKioskFailure,
  loadKioskSuccess,
  loadWallboards,
  loadWallboardsFailure,
  loadWallboardsSuccess,
  revokeWallboard,
  revokeWallboardFailure,
  revokeWallboardSuccess,
} from './wallboards.actions';

export interface ConsoleWallboardsState {
  tokens: WallboardToken[];
  loading: boolean;
  error: string | null;
  creating: boolean;
  /** The token just created, with its plaintext (shown once). */
  created: CreatedWallboardToken | null;
  revoking: string | null;
  tokenError: string | null;
  kiosk: KioskView | null;
  kioskLoading: boolean;
  kioskError: string | null;
  kioskUnauthorized: boolean;
  kioskUpdatedAt: string | null;
}

export const initialConsoleWallboardsState: ConsoleWallboardsState = {
  tokens: [],
  loading: false,
  error: null,
  creating: false,
  created: null,
  revoking: null,
  tokenError: null,
  kiosk: null,
  kioskLoading: false,
  kioskError: null,
  kioskUnauthorized: false,
  kioskUpdatedAt: null,
};

/** The list never carries the plaintext token. */
function withoutPlaintext(token: CreatedWallboardToken): WallboardToken {
  const listed: Partial<CreatedWallboardToken> = { ...token };

  delete listed.token;

  return listed as WallboardToken;
}

export const consoleWallboardsReducer = createReducer(
  initialConsoleWallboardsState,
  on(loadWallboards, (state) => ({ ...state, loading: true, error: null })),
  on(loadWallboardsSuccess, (state, { tokens }) => ({ ...state, tokens, loading: false })),
  on(loadWallboardsFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(createWallboard, (state) => ({ ...state, creating: true, created: null, tokenError: null })),
  on(createWallboardSuccess, (state, { token }) => ({
    ...state,
    creating: false,
    created: token,
    tokens: [withoutPlaintext(token), ...state.tokens],
  })),
  on(createWallboardFailure, (state, { error }) => ({ ...state, creating: false, tokenError: error })),
  on(clearCreatedWallboard, (state) => ({ ...state, created: null })),
  on(revokeWallboard, (state, { id }) => ({ ...state, revoking: id, tokenError: null })),
  on(revokeWallboardSuccess, (state, { id }) => ({
    ...state,
    revoking: null,
    tokens: state.tokens.filter((t) => t.id !== id),
  })),
  on(revokeWallboardFailure, (state, { error }) => ({ ...state, revoking: null, tokenError: error })),
  on(loadKiosk, (state, { silent }) => ({ ...state, kioskLoading: !silent, kioskError: null })),
  on(loadKioskSuccess, (state, { view, at }) => ({
    ...state,
    kiosk: view,
    kioskLoading: false,
    kioskUnauthorized: false,
    kioskUpdatedAt: at,
  })),
  // An invalid token drops what was shown; a network hiccup keeps the last view (with the error).
  on(loadKioskFailure, (state, { error, unauthorized }) => ({
    ...state,
    kiosk: unauthorized ? null : state.kiosk,
    kioskLoading: false,
    kioskError: error,
    kioskUnauthorized: unauthorized,
  })),
);
