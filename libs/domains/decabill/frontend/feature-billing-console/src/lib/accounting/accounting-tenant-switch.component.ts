import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  AccountingFacade,
  BillingCapabilitiesFacade,
  billingTenantDisplayName,
  resolveBillingTenantDisplayName,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { ENVIRONMENT, type Environment } from '@forepath/decabill/frontend/util-configuration';

import { BillingTenantSwitchComponent, type BillingTenantSwitchOption } from '../shared/tenant-switch.component';

/** Id of the "All tenants" option (`viewTenantId=all`). */
export const ACCOUNTING_ALL_TENANTS = 'all';

/**
 * Viewed-tenant switch of the accounting pages: the tenant chip in the page header (`fpcPageHeaderContext`) with one
 * option per viewable tenant plus "All tenants". Shown only with accounting global access. Switching reloads the
 * tenant-scoped data of the page.
 */
@Component({
  selector: 'framework-accounting-tenant-switch',
  standalone: true,
  imports: [BillingTenantSwitchComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'd-inline-flex min-w-0 mw-100' },
  template: `
    @if (visible()) {
      <framework-billing-tenant-switch
        [options]="options()"
        [activeId]="activeId()"
        (selectTenant)="select($event)"
        data-testid="accounting-tenant-switch"
      />
    }
  `,
})
export class AccountingTenantSwitchComponent {
  private readonly facade = inject(AccountingFacade);
  private readonly capabilities = inject(BillingCapabilitiesFacade);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  readonly homeTenantId = this.environment.billing?.tenantId?.trim() || 'default';
  readonly allTenants = ACCOUNTING_ALL_TENANTS;
  readonly allTenantsLabel = $localize`:@@featureAccountingTenantTabs-all:All tenants`;
  private readonly homeLabel = resolveBillingTenantDisplayName(this.environment);
  private readonly homeNote = $localize`:@@featureAccountingTenantSwitch-home:Home tenant`;
  private readonly allNote = $localize`:@@featureAccountingTenantSwitch-allNote:Entity-wide view across all tenants`;
  private readonly globalAccess = toSignal(this.capabilities.accountingGlobalAccess$, { initialValue: false });
  private readonly viewable = toSignal(this.capabilities.viewableTenants$, { initialValue: [] as string[] });
  private readonly viewTenantId = toSignal(this.facade.viewTenantId$, { initialValue: null as string | null });

  readonly visible = computed(() => this.globalAccess() === true);
  readonly tenants = computed(() => {
    const list = this.viewable() ?? [];

    return list.includes(this.homeTenantId) ? list : [this.homeTenantId, ...list];
  });
  readonly options = computed<BillingTenantSwitchOption[]>(() => [
    ...this.tenants().map((tenantId) => ({
      id: tenantId,
      label: this.tenantLabel(tenantId),
      description: tenantId === this.homeTenantId ? this.homeNote : undefined,
    })),
    { id: this.allTenants, label: this.allTenantsLabel, icon: 'buildings', description: this.allNote },
  ]);
  readonly activeId = computed(() => this.viewTenantId() ?? this.homeTenantId);

  tenantLabel(tenantId: string): string {
    if (tenantId === this.homeTenantId) return this.homeLabel;

    return billingTenantDisplayName(tenantId);
  }

  select(tenantId: string): void {
    if (!tenantId || tenantId === this.activeId()) return;

    this.facade.setViewTenant(tenantId === this.homeTenantId ? null : tenantId);
  }
}
