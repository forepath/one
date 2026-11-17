import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { InventoryMovementLocation } from '@forepath/decabill/frontend/data-access-billing-console';

/**
 * Where a movement took stock from and put it to, styled like Agenstra's audit transfer cell: one icon + value per
 * side (leaves: box-arrow-up, arrives: box-arrow-in-down — the withdrawal / putaway icons); a missing side is omitted.
 */
@Component({
  selector: 'framework-inventory-route-cell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="small text-nowrap">
      @if (source(); as from) {
        <span [attr.title]="fromLabel"
          ><i class="bi bi-box-arrow-up me-1" aria-hidden="true"></i
          ><span class="visually-hidden">{{ fromLabel }} </span
          ><span class="font-monospace">{{ from.warehouseCode }} / {{ from.compartmentCode }}</span></span
        >
      }
      @if (target(); as to) {
        <span [class.ms-2]="!!source()" [attr.title]="toLabel"
          ><i class="bi bi-box-arrow-in-down me-1" aria-hidden="true"></i
          ><span class="visually-hidden">{{ toLabel }} </span
          ><span class="font-monospace">{{ to.warehouseCode }} / {{ to.compartmentCode }}</span></span
        >
      }
    </span>
  `,
})
export class InventoryRouteCellComponent {
  readonly source = input<InventoryMovementLocation | null>(null);
  readonly target = input<InventoryMovementLocation | null>(null);

  readonly fromLabel = $localize`:@@featureInventoryMove-source:From`;
  readonly toLabel = $localize`:@@featureInventoryMove-target:To`;
}
