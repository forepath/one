import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

import type { FleetOperation } from '../types/fleet.types';
import { ConsoleEndpointService } from './console-endpoint.service';

export type FleetCatalogTrust = 'official' | 'verified' | 'community';
export type FleetCatalogPackageStatus = 'draft' | 'published' | 'unpublished';

export interface FleetCatalogFinding {
  rule: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  path?: string;
}

/** One uploaded package version of the fleet's app catalog (P1 app store). */
export interface FleetCatalogPackage {
  id: string;
  app: string;
  version: string;
  channel: string;
  title: string;
  summary: string;
  manifestPublisher: string;
  license: string;
  /** The manifest's `minLoadweaver` (null: none, or uploaded before it was recorded). */
  minLoadweaver?: string | null;
  digest: string;
  size: number;
  status: FleetCatalogPackageStatus;
  findings: FleetCatalogFinding[];
  uploadedBy: string | null;
  createdAt: string;
  publishedAt: string | null;
  takenDown: boolean;
}

export interface FleetCatalogTakedown {
  id: string;
  app: string;
  versions: 'all' | string[];
  reason: string;
  createdBy: string | null;
  createdAt: string;
}

/** `GET /catalog`: the catalog's name, URL (null: `FLEET_PUBLIC_URL` unset) and the key clusters pin. */
export interface FleetCatalogInfo {
  name: string;
  title: string;
  publisher: string;
  trust: FleetCatalogTrust;
  url: string | null;
  publicKey: string;
  keyId: string;
  keyType: string;
  index: { generatedAt: string; digest: string } | null;
  paths: { key: string; index: string; indexSignature: string; package: string; packageSignature: string };
}

/** A catalog entry of `Cluster.spec.appStore` the operation sets. */
export interface FleetCatalogSettingsSource {
  name: string;
  type: 'oci' | 'git' | 'fleet';
  url: string;
  ref?: string;
  publicKeys?: string[];
  official?: boolean;
  enabled?: boolean;
}

/** `POST /operations/catalog-settings`: one operation per cluster. */
export interface CreateFleetCatalogSettings {
  clusterIds: string[];
  includeFleetCatalog?: boolean;
  fleetCatalogEnabled?: boolean;
  fleetUrl?: string;
  catalogs?: FleetCatalogSettingsSource[];
  enable?: string[];
  disable?: string[];
  replaceCatalogs?: boolean;
  allowedTrust?: FleetCatalogTrust[];
  apply?: boolean;
}

/**
 * The fleet's app catalog (P1 app store; fleet mode, fleet admins): packages (upload, publish / unpublish, delete),
 * takedowns, the catalog URL + key, and the "apply catalog settings" fleet operation.
 */
@Injectable({ providedIn: 'root' })
export class FleetCatalogService {
  private readonly http = inject(HttpClient);
  private readonly endpoints = inject(ConsoleEndpointService);

  private url(path: string): string {
    return `${this.endpoints.fleetApi()}${path}`;
  }

  private version(app: string, version: string): string {
    return this.url(`/catalog/packages/${encodeURIComponent(app)}/${encodeURIComponent(version)}`);
  }

  /** The fleet's public base URL as this console reaches it (the fleet API URL without `/api`). */
  consoleFleetUrl(origin: string): string | null {
    try {
      const url = new URL(this.endpoints.fleetApi() || '/api', origin);

      return `${url.origin}${url.pathname.replace(/\/api\/?$/, '')}`.replace(/\/+$/, '');
    } catch {
      return null;
    }
  }

  info(): Observable<FleetCatalogInfo> {
    return this.http.get<FleetCatalogInfo>(this.url('/catalog'));
  }

  packages(): Observable<FleetCatalogPackage[]> {
    return this.http.get<FleetCatalogPackage[]>(this.url('/catalog/packages'));
  }

  /** Uploads a `.tar.gz` built by `lw app package` (raw body). */
  upload(file: Blob, options: { channel?: string; publish?: boolean } = {}): Observable<FleetCatalogPackage> {
    const params: Record<string, string> = {};

    if (options.channel) params['channel'] = options.channel;

    if (options.publish) params['publish'] = 'true';

    return this.http.post<FleetCatalogPackage>(this.url('/catalog/packages'), file, {
      params,
      headers: { 'Content-Type': 'application/gzip' },
    });
  }

  publish(app: string, version: string): Observable<FleetCatalogPackage> {
    return this.http.post<FleetCatalogPackage>(`${this.version(app, version)}/publish`, {});
  }

  unpublish(app: string, version: string): Observable<FleetCatalogPackage> {
    return this.http.post<FleetCatalogPackage>(`${this.version(app, version)}/unpublish`, {});
  }

  remove(app: string, version: string): Observable<void> {
    return this.http.delete<void>(this.version(app, version));
  }

  takedowns(): Observable<FleetCatalogTakedown[]> {
    return this.http.get<FleetCatalogTakedown[]>(this.url('/catalog/takedowns'));
  }

  takedown(app: string, body: { versions?: string[]; reason: string }): Observable<FleetCatalogTakedown> {
    return this.http.post<FleetCatalogTakedown>(this.url(`/catalog/apps/${encodeURIComponent(app)}/takedown`), body);
  }

  liftTakedown(id: string): Observable<void> {
    return this.http.delete<void>(this.url(`/catalog/takedowns/${encodeURIComponent(id)}`));
  }

  applySettings(body: CreateFleetCatalogSettings): Observable<FleetOperation[]> {
    return this.http.post<FleetOperation[]>(this.url('/operations/catalog-settings'), body);
  }
}
