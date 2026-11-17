import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { InventoryFacade } from '@forepath/decabill/frontend/data-access-billing-console';
import { FpcTabComponent, FpcTabGroupComponent } from '@forepath/shared/frontend/ui-components';

export type InventorySection = 'warehouses' | 'articles' | 'requests' | 'lendings' | 'documents';

const SECTION_LINKS: Record<InventorySection, string> = {
  warehouses: '/administration/inventory',
  articles: '/administration/inventory/articles',
  requests: '/administration/inventory/requests',
  lendings: '/administration/inventory/lendings',
  documents: '/administration/inventory/documents',
};

/** Section tabs of the inventory pages; requests show the pending count, lendings the overdue count. */
@Component({
  selector: 'framework-inventory-nav',
  standalone: true,
  imports: [FpcTabGroupComponent, FpcTabComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <fpc-tab-group
      class="flex-shrink-0"
      [activeId]="active()"
      (activeIdChange)="navigate($event)"
      i18n-ariaLabel="@@featureInventoryNav-aria"
      ariaLabel="Inventory sections"
      data-testid="inventory-nav"
    >
      <fpc-tab id="warehouses" icon="building" i18n-label="@@featureInventoryNav-warehouses" label="Warehouses" />
      <fpc-tab id="articles" icon="box-seam" i18n-label="@@featureInventoryNav-articles" label="Articles" />
      <fpc-tab
        id="requests"
        icon="inbox"
        i18n-label="@@featureInventoryNav-requests"
        label="Requests"
        [badge]="pending()"
        i18n-badgeLabel="@@featureInventoryNav-pendingBadge"
        badgeLabel="Pending withdrawal requests"
      />
      <fpc-tab
        id="lendings"
        icon="person-up"
        i18n-label="@@featureInventoryNav-lendings"
        label="Lendings"
        [badge]="overdue()"
        i18n-badgeLabel="@@featureInventoryNav-overdueBadge"
        badgeLabel="Overdue lendings"
      />
      <fpc-tab id="documents" icon="file-earmark-text" i18n-label="@@featureInventoryNav-documents" label="Documents" />
    </fpc-tab-group>
  `,
})
export class InventoryNavComponent {
  readonly active = input.required<InventorySection>();

  private readonly router = inject(Router);
  private readonly facade = inject(InventoryFacade);
  private readonly summary = toSignal(this.facade.summary$, { initialValue: null });

  readonly pending = computed(() => {
    const count = this.summary()?.pendingRequestCount ?? 0;

    return count > 0 ? count : null;
  });

  readonly overdue = computed(() => {
    const count = this.summary()?.overdueLendingCount ?? 0;

    return count > 0 ? count : null;
  });

  navigate(id: string | null): void {
    const section = id as InventorySection | null;

    if (section && section !== this.active() && SECTION_LINKS[section]) {
      void this.router.navigateByUrl(SECTION_LINKS[section]);
    }
  }
}
