import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

import type { CertificateSummary } from '../types/certificates.types';
import { ConsoleApi } from './console-api';

/** Ingress certificates (3.6): the list cluster roles may read (the API has no single-certificate GET). */
@Injectable({ providedIn: 'root' })
export class CertificatesService extends ConsoleApi {
  private readonly http = inject(HttpClient);

  list(): Observable<CertificateSummary[]> {
    return this.http.get<CertificateSummary[]>(this.url('/certificates'));
  }
}
