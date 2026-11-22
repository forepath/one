import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { SETTINGS_ADMIN_ENVIRONMENT } from '../tokens/settings-admin-environment';
import type { SettingStateView, SettingsOverviewResponse, SettingsTarget } from '../types/settings.types';

@Injectable({
  providedIn: 'root',
})
export class SettingsService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject(SETTINGS_ADMIN_ENVIRONMENT);

  private get baseUrl(): string {
    return `${this.environment.apiUrl}/${this.environment.settingsBasePath}`;
  }

  private params(target?: SettingsTarget | null): HttpParams {
    let params = new HttpParams();

    if (target?.level) {
      params = params.set('level', target.level);
    }

    if (target?.level === 'tenant' && target.tenantId) {
      params = params.set('viewTenantId', target.tenantId);
    }

    return params;
  }

  getOverview(target?: SettingsTarget | null): Observable<SettingsOverviewResponse> {
    return this.http.get<SettingsOverviewResponse>(this.baseUrl, { params: this.params(target) });
  }

  upsert(key: string, value: string, target?: SettingsTarget | null): Observable<SettingStateView> {
    return this.http.put<SettingStateView>(
      `${this.baseUrl}/${encodeURIComponent(key)}`,
      { value },
      { params: this.params(target) },
    );
  }

  reset(key: string, target?: SettingsTarget | null): Observable<SettingStateView> {
    return this.http.delete<SettingStateView>(`${this.baseUrl}/${encodeURIComponent(key)}`, {
      params: this.params(target),
    });
  }
}
