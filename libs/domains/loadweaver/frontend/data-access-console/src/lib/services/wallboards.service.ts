import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { defer, type Observable } from 'rxjs';

import type {
  CreatedWallboardToken,
  CreateWallboardTokenRequest,
  KioskView,
  WallboardToken,
} from '../types/wallboards.types';
import { ConsoleApi } from './console-api';

/** A failed kiosk request; `status` 401 means the token is invalid, expired or revoked. */
export class KioskRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'KioskRequestError';
  }
}

/**
 * Wallboards (3.25): read-only tokens for the kiosk view (cluster admins: cluster-wide, project admins: their
 * projects) and the kiosk's data.
 */
@Injectable({ providedIn: 'root' })
export class WallboardsService extends ConsoleApi {
  private readonly http = inject(HttpClient);

  list(): Observable<WallboardToken[]> {
    return this.http.get<WallboardToken[]>(this.url('/wallboards'));
  }

  create(request: CreateWallboardTokenRequest): Observable<CreatedWallboardToken> {
    return this.http.post<CreatedWallboardToken>(this.url('/wallboards'), request);
  }

  revoke(id: string): Observable<void> {
    return this.http.delete<void>(this.url(`/wallboards/${encodeURIComponent(id)}`));
  }

  /**
   * The kiosk's data with `Authorization: Wallboard <token>`. Uses `fetch`, not `HttpClient`: the console's auth
   * interceptor would replace the header with the signed-in user's bearer token for every API URL.
   */
  kiosk(token: string): Observable<KioskView> {
    return defer(async () => {
      const response = await fetch(this.url('/public/wallboard'), {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: `Wallboard ${token}` },
        credentials: 'omit',
        cache: 'no-store',
      });

      if (!response.ok) {
        let message = response.statusText || `HTTP ${response.status}`;

        try {
          const body = (await response.json()) as { message?: unknown };

          if (typeof body?.message === 'string') message = body.message;
        } catch {
          // Not JSON: keep the status text.
        }

        throw new KioskRequestError(response.status, message);
      }

      return (await response.json()) as KioskView;
    });
  }
}
