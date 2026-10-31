/**
 * Wallboards (3.25): `POST|GET /wallboards`, `DELETE /wallboards/{id}` and the kiosk's
 * `GET /public/wallboard` (`Authorization: Wallboard <token>`).
 */
import type { HealthState, InboxItem, OverviewSummary } from './console.types';

/** `GET /wallboards`: tokens the caller manages (not revoked). `projects: null`: the whole cluster. */
export interface WallboardToken {
  id: string;
  name: string;
  projects: string[] | null;
  createdBy: string | null;
  /** Resolved server-side (`null`: deleted user / not a user); the console shows it instead of the id (D11). */
  createdByEmail?: string | null;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
}

/** Returned once on creation; the plaintext token is never shown again. */
export interface CreatedWallboardToken extends WallboardToken {
  token: string;
}

/** `POST /wallboards`. No `projects`: cluster-wide (cluster admins). `expiresInDays`: 1 to 3,650. */
export interface CreateWallboardTokenRequest {
  name: string;
  projects?: string[];
  expiresInDays?: number;
}

/** One screen of the kiosk: the scope, then each project in rotation. */
export interface KioskSection {
  scope: string;
  headline: { state: HealthState; message: string; key: string | null };
  inbox: InboxItem[];
  summary: OverviewSummary;
}

/** `GET /public/wallboard`. */
export interface KioskView {
  name: string;
  sections: KioskSection[];
}
