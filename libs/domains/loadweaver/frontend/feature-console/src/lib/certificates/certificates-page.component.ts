import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterModule } from '@angular/router';
import {
  apiErrorMessage,
  CertificatesService,
  type CertificateSummary,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcEmptyStateComponent,
  FpcPageHeaderComponent,
  FpcPanelComponent,
  FpcSpinnerComponent,
} from '@forepath/shared/frontend/ui-components';
import { map } from 'rxjs';

/** Certificates expiring within this many days are flagged. */
export const CERTIFICATE_WARN_DAYS = 14;

export type CertificateState = 'valid' | 'expiring' | 'expired' | 'pending' | 'failing';

/** How a certificate stands: failing renewals first, then by its expiry. */
export function certificateState(certificate: CertificateSummary, now = Date.now()): CertificateState {
  const notAfter = certificate.notAfter ? Date.parse(certificate.notAfter) : NaN;

  if (Number.isFinite(notAfter) && notAfter <= now) return 'expired';

  if (certificate.failures > 0 || certificate.lastError) return 'failing';

  if (!Number.isFinite(notAfter)) return 'pending';

  return notAfter - now <= CERTIFICATE_WARN_DAYS * 86_400_000 ? 'expiring' : 'valid';
}

export const CERTIFICATE_STATE_TONE: Record<CertificateState, 'success' | 'warning' | 'danger' | 'secondary'> = {
  valid: 'success',
  expiring: 'warning',
  expired: 'danger',
  pending: 'secondary',
  failing: 'danger',
};

export function certificateStateLabel(state: CertificateState): string {
  switch (state) {
    case 'valid':
      return $localize`:@@lwConsoleCertificates-stateValid:Valid`;
    case 'expiring':
      return $localize`:@@lwConsoleCertificates-stateExpiring:Expires soon`;
    case 'expired':
      return $localize`:@@lwConsoleCertificates-stateExpired:Expired`;
    case 'pending':
      return $localize`:@@lwConsoleCertificates-statePending:Not issued yet`;
    default:
      return $localize`:@@lwConsoleCertificates-stateFailing:Renewal failing`;
  }
}

/**
 * Ingress certificates (3.6, cluster roles): ACME-issued and uploaded ones with their names, expiry and renewal
 * failures. `/certificates/<id>` (inbox and overview links) shows one of them.
 */
@Component({
  selector: 'loadweaver-certificates-page',
  imports: [
    CommonModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcEmptyStateComponent,
    FpcPageHeaderComponent,
    FpcPanelComponent,
    FpcSpinnerComponent,
  ],
  templateUrl: './certificates-page.component.html',
  standalone: true,
})
export class LoadweaverCertificatesPageComponent implements OnInit {
  private readonly service = inject(CertificatesService);
  private readonly route = inject(ActivatedRoute);

  readonly selectedId = toSignal(this.route.paramMap.pipe(map((params) => params.get('id'))), {
    initialValue: this.route.snapshot.paramMap.get('id'),
  });
  readonly certificates = signal<CertificateSummary[]>([]);
  readonly loading = signal(false);
  readonly loaded = signal(false);
  readonly error = signal<string | null>(null);

  readonly selected = computed(() => {
    const id = this.selectedId();

    return id ? (this.certificates().find((c) => c.id === id) ?? null) : null;
  });

  readonly state = certificateState;
  readonly stateLabel = certificateStateLabel;
  readonly tone = CERTIFICATE_STATE_TONE;

  readonly title = $localize`:@@lwConsoleCertificates-title:Certificates`;
  readonly refreshLabel = $localize`:@@lwConsoleCertificates-refresh:Refresh`;
  readonly sourceAcme = $localize`:@@lwConsoleCertificates-sourceAcme:ACME`;
  readonly sourceCustom = $localize`:@@lwConsoleCertificates-sourceCustom:Uploaded`;

  ngOnInit(): void {
    this.load();
  }

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
}
