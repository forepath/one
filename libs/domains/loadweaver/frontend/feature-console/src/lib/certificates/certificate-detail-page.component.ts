import { CommonModule, formatDate } from '@angular/common';
import { Component, computed, inject, LOCALE_ID, OnInit } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterModule } from '@angular/router';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcEmptyStateComponent,
  FpcKeyValueDirective,
  type FpcKeyValueItem,
  FpcKeyValueListComponent,
  FpcPageHeaderComponent,
} from '@forepath/shared/frontend/ui-components';
import { map } from 'rxjs';

import { CERTIFICATE_STATE_TONE, certificateState, certificateStateLabel } from './certificates-page.component';
import { LoadweaverCertificatesStore } from './certificates-store';

/** One certificate (3.38: the detail route of the certificates master-detail shell, `/delivery/certificates/<id>`). */
@Component({
  selector: 'loadweaver-certificate-detail-page',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcEmptyStateComponent,
    FpcKeyValueDirective,
    FpcKeyValueListComponent,
    FpcPageHeaderComponent,
  ],
  template: `
    <div class="fpc-page">
      <fpc-page-header [title]="id() ?? title">
        <!-- Back sits left above the title, below xl only (3.38 R8). -->
        <a
          fpcPageHeaderBreadcrumbs
          class="fpc-md__back small text-decoration-none align-items-center"
          routerLink="/delivery/certificates"
          data-testid="certificate-back"
        >
          <i class="bi bi-arrow-left me-1" aria-hidden="true"></i>{{ backLabel }}
        </a>
      </fpc-page-header>

      @if (store.loading() && !selected()) {
        <fpc-empty-state [loading]="true" [title]="loadingLabel" />
      } @else if (selected(); as c) {
        <div class="flex-grow-1 overflow-auto min-h-0 px-3 py-2" data-testid="certificate-detail">
          <fpc-key-value-list [items]="facts()">
            <ng-template fpcKeyValue="state">
              <fpc-badge [tone]="tone[state(c)]">{{ stateLabel(state(c)) }}</fpc-badge>
            </ng-template>
            <ng-template fpcKeyValue="names">
              @for (name of c.names; track name) {
                <div class="font-monospace">{{ name }}</div>
              }
            </ng-template>
            <ng-template fpcKeyValue="lastError">
              <span class="text-danger text-break">{{ c.lastError }}</span>
            </ng-template>
          </fpc-key-value-list>
        </div>
      } @else if (store.loaded()) {
        <fpc-alert
          [flush]="true"
          variant="warning"
          i18n-message="@@lwConsoleCertificates-notFound"
          message="This certificate doesn't exist (any more)."
          data-testid="certificate-not-found"
        />
      }
    </div>
  `,
})
export class LoadweaverCertificateDetailPageComponent implements OnInit {
  readonly store = inject(LoadweaverCertificatesStore);
  private readonly route = inject(ActivatedRoute);
  private readonly locale = inject(LOCALE_ID);

  readonly id = toSignal(this.route.paramMap.pipe(map((params) => params.get('id'))), {
    initialValue: this.route.snapshot.paramMap.get('id'),
  });
  readonly selected = computed(() => {
    const id = this.id();

    return id ? (this.store.certificates().find((c) => c.id === id) ?? null) : null;
  });

  readonly state = certificateState;
  readonly stateLabel = certificateStateLabel;
  readonly tone = CERTIFICATE_STATE_TONE;

  readonly title = $localize`:@@lwConsoleCertificates-title:Certificates`;
  readonly backLabel = $localize`:@@lwConsoleMasterDetail-back:Back to the list`;
  readonly loadingLabel = $localize`:@@lwConsoleCertificates-loading:Loading certificates`;
  readonly sourceAcme = $localize`:@@lwConsoleCertificates-sourceAcme:ACME`;
  readonly sourceCustom = $localize`:@@lwConsoleCertificates-sourceCustom:Uploaded`;

  readonly facts = computed<FpcKeyValueItem[]>(() => {
    const c = this.selected();

    if (!c) return [];

    return [
      { key: 'state', label: $localize`:@@lwConsoleCertificates-state:State` },
      {
        key: 'source',
        label: $localize`:@@lwConsoleCertificates-source:Source`,
        value: c.source === 'acme' ? this.sourceAcme : this.sourceCustom,
      },
      { key: 'names', label: $localize`:@@lwConsoleCertificates-names:Names` },
      {
        key: 'notAfter',
        label: $localize`:@@lwConsoleCertificates-notAfter:Valid until`,
        value: c.notAfter ? formatDate(c.notAfter, 'medium', this.locale) : null,
      },
      { key: 'failures', label: $localize`:@@lwConsoleCertificates-failures:Failed renewals`, value: c.failures },
      ...(c.lastError ? [{ key: 'lastError', label: $localize`:@@lwConsoleCertificates-lastError:Last error` }] : []),
    ];
  });

  ngOnInit(): void {
    this.store.ensureLoaded();
  }
}
