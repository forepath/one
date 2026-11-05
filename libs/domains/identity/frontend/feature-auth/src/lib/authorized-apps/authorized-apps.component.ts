import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { AuthService, IdentityAppsFacade, type IdentityAppGrantResponseDto } from '@forepath/identity/frontend';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcConfirmDialogComponent,
  FpcDataTableComponent,
  FpcDatePipe,
  FpcEmptyStateComponent,
  FpcPageHeaderComponent,
  FpcTableCellDirective,
  FpcTooltipComponent,
  fpcRunBulk,
  type FpcMenuItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import { combineLatestWith, firstValueFrom, map } from 'rxjs';

import { SHARED_DL_REVOKE, sharedBulkSummary } from '../data-list';

/** The signed-in user's authorized apps (GitHub "Authorized OAuth Apps"): review scopes and revoke. */
@Component({
  selector: 'identity-auth-authorized-apps',
  imports: [
    CommonModule,
    FpcDatePipe,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcConfirmDialogComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcPageHeaderComponent,
    FpcTableCellDirective,
    FpcTooltipComponent,
  ],
  templateUrl: './authorized-apps.component.html',
  styleUrls: ['./authorized-apps.component.scss'],
  standalone: true,
})
export class IdentityAuthorizedAppsComponent implements OnInit {
  private readonly facade = inject(IdentityAppsFacade);
  private readonly authService = inject(AuthService);

  readonly pageTitle = $localize`:@@featureAuthorizedApps-title:Authorized apps`;
  readonly searchPlaceholder = $localize`:@@featureAuthorizedApps-searchPlaceholder:Search apps`;
  readonly emptyMessage = $localize`:@@featureAuthorizedApps-empty:You have not authorized any apps`;
  readonly revokeLabel = SHARED_DL_REVOKE;

  readonly searchQuery = signal('');
  private readonly searchQuery$ = toObservable(this.searchQuery);
  readonly grants = toSignal(
    this.facade.ownGrants$.pipe(
      combineLatestWith(this.searchQuery$),
      map(([grants, query]) => {
        const needle = query.trim().toLowerCase();

        return needle
          ? grants.filter((grant) =>
              `${grant.appName} ${grant.appDescription ?? ''} ${grant.scopes.join(' ')}`.toLowerCase().includes(needle),
            )
          : grants;
      }),
    ),
    { initialValue: [] as IdentityAppGrantResponseDto[] },
  );
  readonly loading = toSignal(this.facade.ownGrantsLoading$, { initialValue: false });
  readonly revoking = toSignal(this.facade.ownGrantsRevoking$, { initialValue: false });
  readonly error = toSignal(this.facade.ownGrantsError$, { initialValue: null as string | null });

  readonly selectedIds = signal<readonly string[]>([]);
  readonly bulkBusy = signal(false);
  readonly bulkRevokeOpen = signal(false);
  readonly bulkResult = signal<{ tone: 'success' | 'warning' | 'danger'; message: string } | null>(null);
  readonly selectedGrants = computed(() => {
    const ids = new Set(this.selectedIds());

    return this.grants().filter((grant) => ids.has(grant.id));
  });

  readonly revokeDialogOpen = signal(false);
  grantToRevoke: IdentityAppGrantResponseDto | null = null;

  readonly columns: FpcTableColumn<IdentityAppGrantResponseDto>[] = [
    {
      id: 'state',
      label: $localize`:@@featureAuthorizedApps-colState:State`,
      type: 'state',
      state: (grant) =>
        grant.needsReauthorization
          ? {
              label: $localize`:@@featureAuthorizedApps-stateReauth:Requests more access`,
              tone: 'warning',
              icon: 'arrow-repeat',
            }
          : {
              label: $localize`:@@featureAuthorizedApps-stateActive:Authorized`,
              tone: 'success',
              icon: 'check-circle',
            },
    },
    {
      id: 'app',
      label: $localize`:@@featureAuthorizedApps-colApp:App`,
      value: (grant) => grant.appName,
      required: true,
      priority: 1,
    },
    { id: 'scopes', label: $localize`:@@featureAuthorizedApps-colScopes:Scopes`, priority: 1 },
    {
      id: 'authorized',
      label: $localize`:@@featureAuthorizedApps-colAuthorized:Authorized`,
      value: (grant) => grant.createdAt,
      priority: 2,
    },
    {
      id: 'lastUsed',
      label: $localize`:@@featureAuthorizedApps-colLastUsed:Last used`,
      value: (grant) => grant.lastUsedAt ?? '',
      priority: 2,
    },
  ];

  readonly rowMenu = (): FpcMenuItem[] => [{ id: 'revoke', label: SHARED_DL_REVOKE, icon: 'x-octagon', danger: true }];

  ngOnInit(): void {
    this.facade.loadOwnGrants();
  }

  onRefresh(): void {
    this.facade.loadOwnGrants();
  }

  scopesText(grant: IdentityAppGrantResponseDto): string {
    return grant.scopes.join('\n');
  }

  onAction(grant: IdentityAppGrantResponseDto, action: string): void {
    if (action === 'revoke') {
      this.grantToRevoke = grant;
      this.revokeDialogOpen.set(true);
    }
  }

  confirmRevoke(): void {
    this.revokeDialogOpen.set(false);

    if (this.grantToRevoke) {
      this.facade.revokeOwnGrant(this.grantToRevoke.id);
    }

    this.grantToRevoke = null;
  }

  async onConfirmBulkRevoke(): Promise<void> {
    this.bulkRevokeOpen.set(false);
    const grants = this.selectedGrants();

    if (grants.length === 0) {
      return;
    }

    this.bulkBusy.set(true);
    this.bulkResult.set(null);

    try {
      const result = await fpcRunBulk(grants, (grant) => firstValueFrom(this.authService.revokeOwnAppGrant(grant.id)));

      this.bulkResult.set(sharedBulkSummary(result, (grant) => grant.appName));
      this.selectedIds.set(result.failed.concat(result.denied).map((grant) => grant.id));
      this.facade.loadOwnGrants();
    } finally {
      this.bulkBusy.set(false);
    }
  }
}
