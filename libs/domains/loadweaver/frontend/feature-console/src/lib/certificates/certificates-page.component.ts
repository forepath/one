import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { type CertificateSummary } from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  type FpcBadgeTone,
  FpcButtonComponent,
  fpcCopyText,
  FpcDataTableComponent,
  FpcDatePipe,
  FpcEmptyStateComponent,
  FpcPageHeaderComponent,
  FpcTableCellDirective,
  type FpcMenuItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import { filterBySearch } from '../list-search';
import { dlCopyIdItem, dlOpenItem } from '../section/data-list';
import { MasterDetailState } from '../section/master-detail.component';
import { savedViewBinding } from '../views/saved-views';
import { LoadweaverSavedViewsComponent } from '../views/saved-views.component';
import { LoadweaverCertificatesStore } from './certificates-store';

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

export const CERTIFICATE_STATE_TONE: Record<CertificateState, FpcBadgeTone> = {
  valid: 'success',
  expiring: 'warning',
  expired: 'danger',
  pending: 'neutral',
  failing: 'danger',
};

/** A certificate as people name it: its first DNS name, `+N` for more (the id only without names). */
export function certificateTitle(certificate: Pick<CertificateSummary, 'id' | 'names'>): string {
  const [first, ...rest] = certificate.names;

  if (!first) return certificate.id;

  return rest.length ? `${first} +${rest.length}` : first;
}

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
 * failures. 3.38: the list lane of the master-detail shell (`loadweaver-master-detail`); `/delivery/certificates/<id>`
 * (inbox and overview links) is the detail route (`LoadweaverCertificateDetailPageComponent`).
 */
@Component({
  selector: 'loadweaver-certificates-page',
  imports: [
    LoadweaverSavedViewsComponent,
    FpcAlertComponent,
    FpcButtonComponent,
    FpcDataTableComponent,
    FpcDatePipe,
    FpcEmptyStateComponent,
    FpcPageHeaderComponent,
    FpcTableCellDirective,
    CommonModule,
  ],
  templateUrl: './certificates-page.component.html',
  standalone: true,
})
export class LoadweaverCertificatesPageComponent implements OnInit {
  private readonly store = inject(LoadweaverCertificatesStore);
  private readonly router = inject(Router);
  private readonly masterDetail = inject(MasterDetailState, { optional: true });

  readonly selectedId = computed(() => this.masterDetail?.selectedId() ?? null);
  readonly certificates = this.store.certificates;
  readonly loading = this.store.loading;
  readonly error = this.store.error;

  readonly search = signal('');
  /** "Views ▾" (3.37): saved search / filters of this list, per user. */
  readonly views = savedViewBinding({ search: this.search });
  readonly filtered = computed(() =>
    filterBySearch(this.certificates(), this.search(), (c) => [
      c.id,
      c.names,
      c.source === 'acme' ? this.sourceAcme : this.sourceCustom,
      this.stateLabel(this.state(c)),
      c.lastError,
    ]),
  );

  readonly state = certificateState;
  readonly expiresLabel = $localize`:@@lwConsoleCertificates-expires:Expires`;
  readonly stateLabel = certificateStateLabel;
  readonly tone = CERTIFICATE_STATE_TONE;

  readonly title = $localize`:@@lwConsoleCertificates-title:Certificates`;
  readonly refreshLabel = $localize`:@@lwConsoleCertificates-refresh:Refresh`;
  readonly sourceAcme = $localize`:@@lwConsoleCertificates-sourceAcme:ACME`;
  readonly sourceCustom = $localize`:@@lwConsoleCertificates-sourceCustom:Uploaded`;
  readonly searchLabel = $localize`:@@lwConsoleCertificates-search:Search certificates`;
  readonly loadingLabel = $localize`:@@lwConsoleCertificates-loading:Loading certificates`;

  /** Narrow list lane (30 rem): id, state and expiry; names and source via the column chooser. */
  readonly columns: FpcTableColumn<CertificateSummary>[] = [
    {
      id: 'state',
      label: $localize`:@@lwConsoleCertificates-state:State`,
      type: 'state',
      state: (c) => ({
        label: certificateStateLabel(certificateState(c)),
        tone: CERTIFICATE_STATE_TONE[certificateState(c)],
      }),
    },
    {
      id: 'id',
      label: $localize`:@@lwConsoleCertificates-id:Certificate`,
      // Its first DNS name (+N), not the resource id (D11, LW-22); the id stays in ⋮ Copy ID.
      value: (c) => certificateTitle(c),
      required: true,
      priority: 1,
    },
    {
      id: 'notAfter',
      label: $localize`:@@lwConsoleCertificates-notAfter:Valid until`,
      value: (c) => c.notAfter ?? '',
      priority: 1,
    },
    {
      id: 'names',
      label: $localize`:@@lwConsoleCertificates-names:Names`,
      value: (c) => c.names.join(', '),
      hidden: true,
      mono: true,
    },
    {
      id: 'source',
      label: $localize`:@@lwConsoleCertificates-source:Source`,
      value: (c) => (c.source === 'acme' ? this.sourceAcme : this.sourceCustom),
      hidden: true,
    },
  ];
  readonly rowId = (c: CertificateSummary) => c.id;
  readonly rowLink = (c: CertificateSummary): string => `/delivery/certificates/${encodeURIComponent(c.id)}`;
  readonly rowMenu = (): FpcMenuItem[] => [dlOpenItem(), dlCopyIdItem()];

  onRowAction(certificate: CertificateSummary, action: string): void {
    if (action === 'open') this.open(certificate);
    else if (action === 'copy-id') fpcCopyText(certificate.id);
  }

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.store.load();
  }

  open(certificate: CertificateSummary): void {
    void this.router.navigate(['/delivery/certificates', certificate.id]);
  }
}
