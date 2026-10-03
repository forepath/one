import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/agenstra/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/agenstra/frontend/util-configuration';
import { Observable } from 'rxjs';

import type {
  UpsertWorkspaceConfigurationOverrideDto,
  WorkspaceConfigurationSettingResponseDto,
  WorkspaceConfigurationSettingKey,
} from '../state/workspace-config/workspace-config.types';

@Injectable({
  providedIn: 'root',
})
export class WorkspaceConfigService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  private get apiUrl(): string {
    return this.environment.console.urls.restApi;
  }

  listConfigurationOverrides(clientId: string): Observable<WorkspaceConfigurationSettingResponseDto[]> {
    return this.http.get<WorkspaceConfigurationSettingResponseDto[]>(
      `${this.apiUrl}/clients/${clientId}/configuration-overrides`,
    );
  }

  upsertConfigurationOverride(
    clientId: string,
    settingKey: WorkspaceConfigurationSettingKey,
    dto: UpsertWorkspaceConfigurationOverrideDto,
  ): Observable<WorkspaceConfigurationSettingResponseDto> {
    return this.http.put<WorkspaceConfigurationSettingResponseDto>(
      `${this.apiUrl}/clients/${clientId}/configuration-overrides/${settingKey}`,
      dto,
    );
  }

  deleteConfigurationOverride(clientId: string, settingKey: WorkspaceConfigurationSettingKey): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/clients/${clientId}/configuration-overrides/${settingKey}`);
  }
}
