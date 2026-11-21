import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { BillingCapabilitiesFacade } from '@forepath/decabill/frontend/data-access-billing-console';
import { FpcTabComponent, FpcTabGroupComponent } from '@forepath/shared/frontend/ui-components';

export type AccountingSection =
  | 'overview'
  | 'journal'
  | 'accounts'
  | 'banking'
  | 'open-items'
  | 'statements'
  | 'vat-returns'
  | 'assets';

export const ACCOUNTING_SECTION_LINKS: Record<AccountingSection, string> = {
  overview: '/administration/accounting',
  journal: '/administration/accounting/journal',
  accounts: '/administration/accounting/accounts',
  banking: '/administration/accounting/banking',
  'open-items': '/administration/accounting/open-items',
  statements: '/administration/accounting/statements',
  'vat-returns': '/administration/accounting/vat-returns',
  assets: '/administration/accounting/assets',
};

/** Section tabs of the accounting pages; VAT returns and assets are entity-wide (global access only). */
@Component({
  selector: 'framework-accounting-nav',
  standalone: true,
  imports: [FpcTabGroupComponent, FpcTabComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <fpc-tab-group
      class="flex-shrink-0"
      [activeId]="active()"
      (activeIdChange)="navigate($event)"
      i18n-ariaLabel="@@featureAccountingNav-aria"
      ariaLabel="Accounting sections"
      data-testid="accounting-nav"
    >
      <fpc-tab id="overview" icon="speedometer2" i18n-label="@@featureAccountingNav-overview" label="Overview" />
      <fpc-tab id="journal" icon="journal-text" i18n-label="@@featureAccountingNav-journal" label="Journal" />
      <fpc-tab id="accounts" icon="list-ol" i18n-label="@@featureAccountingNav-accounts" label="Accounts" />
      <fpc-tab id="banking" icon="bank" i18n-label="@@featureAccountingNav-banking" label="Banking" />
      <fpc-tab
        id="open-items"
        icon="hourglass-split"
        i18n-label="@@featureAccountingNav-openItems"
        label="Open items"
      />
      <fpc-tab
        id="statements"
        icon="file-earmark-bar-graph"
        i18n-label="@@featureAccountingNav-statements"
        label="Statements"
      />
      @if (globalAccess()) {
        <fpc-tab id="vat-returns" icon="percent" i18n-label="@@featureAccountingNav-vatReturns" label="VAT returns" />
        <fpc-tab id="assets" icon="pc-display" i18n-label="@@featureAccountingNav-assets" label="Assets" />
      }
    </fpc-tab-group>
  `,
})
export class AccountingNavComponent {
  readonly active = input.required<AccountingSection>();

  private readonly router = inject(Router);
  private readonly capabilities = inject(BillingCapabilitiesFacade);
  private readonly accountingGlobalAccess = toSignal(this.capabilities.accountingGlobalAccess$, {
    initialValue: false,
  });

  readonly globalAccess = computed(() => this.accountingGlobalAccess() === true);

  navigate(id: string | null): void {
    const section = id as AccountingSection | null;

    if (section && section !== this.active() && ACCOUNTING_SECTION_LINKS[section]) {
      void this.router.navigateByUrl(ACCOUNTING_SECTION_LINKS[section]);
    }
  }
}
