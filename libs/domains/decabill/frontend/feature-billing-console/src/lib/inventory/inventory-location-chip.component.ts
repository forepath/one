import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FpcBadgeComponent } from '@forepath/shared/frontend/ui-components';

/**
 * A chosen compartment (`HQ / A-01-01`) as chip, like a picked user in the admin user select: an info badge with an
 * optional close button that clears the choice (instead of an underlined "Change" link).
 */
@Component({
  selector: 'framework-inventory-location-chip',
  standalone: true,
  imports: [FpcBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <fpc-badge variant="info" color="secondary" class="inventory-location-chip">
      <i class="bi bi-geo-alt me-1" aria-hidden="true"></i>
      <span class="font-monospace text-truncate">{{ warehouseCode() }} / {{ compartmentCode() }}</span>
      @if (clearable()) {
        <button
          type="button"
          class="btn-close inventory-location-chip__clear"
          [attr.aria-label]="clearLabel"
          [title]="clearLabel"
          (click)="cleared.emit()"
          data-testid="inventory-location-chip-clear"
        ></button>
      }
    </fpc-badge>
  `,
  styles: `
    :host {
      display: inline-flex;
      min-width: 0;
      max-width: 100%;
    }

    .inventory-location-chip {
      max-width: min(100%, 22rem);
    }

    .inventory-location-chip__clear {
      width: 0.5rem;
      height: 0.5rem;
      padding: 0;
      margin-left: 0.25rem;
      background-size: 0.5rem;
      opacity: 0.55;

      &:hover,
      &:focus-visible {
        opacity: 1;
      }
    }
  `,
})
export class InventoryLocationChipComponent {
  readonly warehouseCode = input.required<string>();
  readonly compartmentCode = input.required<string>();
  readonly clearable = input(false);
  readonly cleared = output<void>();

  readonly clearLabel = $localize`:@@featureInventoryMove-change:Change`;
}
