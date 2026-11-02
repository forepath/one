import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

import type {
  CertificateTrustSettings,
  PostureIntegration,
  PostureIntegrationInput,
  PosturePluginInfo,
  PostureTestResult,
} from '../types/remote-access.types';
import { ConsoleApi } from './console-api';

/**
 * Device posture integrations (3.31, cluster settings): MDM / EDR integrations (secrets write-only), connection
 * tests, manual syncs and the trust settings for device certificates.
 */
@Injectable({ providedIn: 'root' })
export class ConsolePostureService extends ConsoleApi {
  private readonly http = inject(HttpClient);

  plugins(): Observable<PosturePluginInfo[]> {
    return this.http.get<PosturePluginInfo[]>(this.url('/posture/plugins'));
  }

  integrations(): Observable<PostureIntegration[]> {
    return this.http.get<PostureIntegration[]>(this.url('/posture/integrations'));
  }

  create(input: PostureIntegrationInput): Observable<PostureIntegration> {
    return this.http.post<PostureIntegration>(this.url('/posture/integrations'), input);
  }

  update(id: string, input: PostureIntegrationInput): Observable<PostureIntegration> {
    return this.http.patch<PostureIntegration>(this.url(`/posture/integrations/${encodeURIComponent(id)}`), input);
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(this.url(`/posture/integrations/${encodeURIComponent(id)}`));
  }

  test(id: string): Observable<PostureTestResult> {
    return this.http.post<PostureTestResult>(this.url(`/posture/integrations/${encodeURIComponent(id)}/test`), {});
  }

  testUnsaved(type: string, config: Record<string, string>): Observable<PostureTestResult> {
    return this.http.post<PostureTestResult>(this.url('/posture/integrations/test'), { type, config });
  }

  sync(id: string): Observable<void> {
    return this.http.post<void>(this.url(`/posture/integrations/${encodeURIComponent(id)}/sync`), {});
  }

  certificateTrust(): Observable<CertificateTrustSettings> {
    return this.http.get<CertificateTrustSettings>(this.url('/posture/certificates'));
  }

  updateCertificateTrust(
    input: Partial<Omit<CertificateTrustSettings, 'companyCaSubjects' | 'updatedAt'>>,
  ): Observable<CertificateTrustSettings> {
    return this.http.put<CertificateTrustSettings>(this.url('/posture/certificates'), input);
  }
}
