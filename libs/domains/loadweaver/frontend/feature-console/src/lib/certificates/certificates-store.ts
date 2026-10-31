import { inject, Injectable, signal } from '@angular/core';
import {
  apiErrorMessage,
  CertificatesService,
  type CertificateSummary,
} from '@forepath/loadweaver/frontend/data-access-console';

/**
 * The certificates of the master-detail section (3.38: one shell): provided on the route, shared by the list lane and
 * the detail route so both read one load.
 */
@Injectable()
export class LoadweaverCertificatesStore {
  private readonly service = inject(CertificatesService);

  readonly certificates = signal<CertificateSummary[]>([]);
  readonly loading = signal(false);
  readonly loaded = signal(false);
  readonly error = signal<string | null>(null);

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.service.list().subscribe({
      next: (certificates) => {
        this.certificates.set(certificates);
        this.loading.set(false);
        this.loaded.set(true);
      },
      error: (error: unknown) => {
        this.certificates.set([]);
        this.loading.set(false);
        this.loaded.set(true);
        this.error.set(apiErrorMessage(error, 'Failed to load the certificates'));
      },
    });
  }

  /** Loads once (the detail opened by a deep link before the list). */
  ensureLoaded(): void {
    if (!this.loaded() && !this.loading()) this.load();
  }
}
