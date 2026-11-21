import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import {
  FPC_DEFAULT_PAGE_SIZE,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcModalComponent,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';

/** One entry of the tenant switch: a tenant, or a cross-tenant view such as "All tenants" / "Unified". */
export interface BillingTenantSwitchOption {
  id: string;
  label: string;
  /** Bootstrap icon of the chip and the state cell; defaults to `building`. */
  icon?: string;
  /** Short note in the second column (e.g. "Home tenant", "Across all tenants"). */
  description?: string;
}

const CURRENT_LABEL = $localize`:@@featureBillingTenantSwitch-current:Current`;
const OTHER_LABEL = $localize`:@@featureBillingTenantSwitch-other:Available`;

/**
 * Viewed-tenant switch of the console pages with cross-tenant access (accounting, DATEV exports, file manager): a
 * chip in the page header context slot (`fpcPageHeaderContext`) that shows the current tenant and opens a switch
 * dialog with a searchable table (State, Tenant, Note); a row click switches. Same pattern as Agenstra's
 * workspace chip and workspace switch on the tickets board, replacing the former tenant tab strip.
 */
@Component({
  selector: 'framework-billing-tenant-switch',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FpcBadgeComponent, FpcButtonComponent, FpcDataTableComponent, FpcEmptyStateComponent, FpcModalComponent],
  template: `
    <fpc-button
      variant="link"
      btnClass="text-decoration-none text-body ps-0"
      class="framework-billing-tenant-switch__btn"
      [title]="switchTitle"
      (clicked)="openSwitch()"
      data-testid="tenant-switch-chip"
    >
      <fpc-badge variant="info" color="secondary" class="framework-billing-tenant-switch__badge">
        <i class="bi bi-{{ current()?.icon ?? 'building' }}" aria-hidden="true"></i>
        <span class="text-truncate framework-billing-tenant-switch__label">{{ current()?.label ?? activeId() }}</span>
      </fpc-badge>
    </fpc-button>

    <fpc-modal [(open)]="switchOpen" [title]="switchTitle" [scrollable]="true" [bodyScroll]="false">
      <div class="d-flex flex-column flex-grow-1 min-h-0">
        <fpc-data-table
          [ariaLabel]="tableTitle"
          [columns]="columns"
          [rows]="filteredOptions()"
          [activeRowId]="activeId()"
          paging="client"
          [(page)]="page"
          [(pageSize)]="pageSize"
          [(query)]="query"
          [searchPlaceholder]="searchPlaceholder"
          [filtered]="!!query().trim()"
          [showColumnChooser]="false"
          persistKey="decabill-tenant-switch"
          emptyIcon="building"
          (rowActivate)="choose($event)"
          data-testid="tenant-switch-table"
        >
          <span fpcDataTableEmpty>
            <fpc-empty-state icon="building" size="sm" [message]="emptyLabel" />
          </span>
        </fpc-data-table>
      </div>
    </fpc-modal>
  `,
  styles: `
    :host {
      display: inline-flex;
      min-width: 0;
      max-width: 100%;
      /* Title to chip = the header inset (1rem): the header's 0.5rem context gap plus this 0.5rem; the button has no
         leading padding (ps-0). Same spacing as Agenstra's workspace chip. */
      margin-inline-start: calc(var(--fpc-edge-inset, 1rem) - 0.5rem);
    }

    .framework-billing-tenant-switch__btn {
      max-width: 100%;
    }

    .framework-billing-tenant-switch__badge {
      max-width: min(20rem, 70vw);
    }

    /* Out-ranks the badge's own tertiary fill so the chip stands out on the tertiary page header in both themes. */
    .framework-billing-tenant-switch__btn .framework-billing-tenant-switch__badge.fpc-badge--info.fpc-badge--secondary {
      background-color: color-mix(in srgb, var(--bs-tertiary-bg) 86%, var(--bs-emphasis-color));
      border-color: transparent;
      color: var(--bs-emphasis-color);
    }

    .framework-billing-tenant-switch__label {
      min-width: 0;
    }
  `,
})
export class BillingTenantSwitchComponent {
  /** Tenants (and cross-tenant views) to switch between, in display order. */
  readonly options = input<readonly BillingTenantSwitchOption[]>([]);
  /** Id of the viewed option. */
  readonly activeId = input.required<string>();
  /** A different option was chosen. */
  readonly selectTenant = output<string>();

  protected readonly switchOpen = signal(false);
  protected readonly query = signal('');
  protected readonly page = signal(1);
  protected readonly pageSize = signal(FPC_DEFAULT_PAGE_SIZE);

  protected readonly switchTitle = $localize`:@@featureBillingTenantSwitch-title:Switch tenant`;
  protected readonly tableTitle = $localize`:@@featureBillingTenantSwitch-table:Tenants`;
  protected readonly searchPlaceholder = $localize`:@@featureBillingTenantSwitch-search:Search tenants`;
  protected readonly emptyLabel = $localize`:@@featureBillingTenantSwitch-empty:No matching tenants`;

  protected readonly current = computed(() => this.options().find((option) => option.id === this.activeId()) ?? null);
  protected readonly filteredOptions = computed(() => {
    const needle = this.query().trim().toLowerCase();

    if (!needle) return this.options();

    return this.options().filter((option) =>
      [option.label, option.id, option.description ?? ''].some((value) => value.toLowerCase().includes(needle)),
    );
  });

  protected readonly columns: FpcTableColumn<BillingTenantSwitchOption>[] = [
    {
      id: 'state',
      label: $localize`:@@featureBillingTenantSwitch-colState:State`,
      type: 'state',
      state: (option) =>
        option.id === this.activeId()
          ? { label: CURRENT_LABEL, tone: 'primary', icon: 'check2-circle', severity: 0 }
          : { label: OTHER_LABEL, tone: 'neutral', icon: option.icon ?? 'building', severity: 1 },
    },
    {
      id: 'label',
      label: $localize`:@@featureBillingTenantSwitch-colTenant:Tenant`,
      value: (option) => option.label,
      required: true,
      priority: 1,
    },
    {
      id: 'description',
      label: $localize`:@@featureBillingTenantSwitch-colNote:Note`,
      value: (option) => option.description ?? '',
      priority: 2,
    },
  ];

  openSwitch(): void {
    this.query.set('');
    this.page.set(1);
    this.switchOpen.set(true);
  }

  choose(option: BillingTenantSwitchOption): void {
    this.switchOpen.set(false);

    if (option.id !== this.activeId()) this.selectTenant.emit(option.id);
  }
}
