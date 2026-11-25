import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { CustomerDeliveryPreference } from '@forepath/decabill/frontend/data-access-billing-console';
import { FpcFormControlComponent, FpcFormFieldComponent } from '@forepath/shared/frontend/ui-components';

/**
 * Preferred delivery of a customer (billing profile, customer and admin forms): email, or email plus a letter. Shown
 * while letters are available, and when the profile already prefers letters (so it can be switched back).
 */
@Component({
  selector: 'framework-delivery-preference-field',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, FpcFormFieldComponent, FpcFormControlComponent],
  template: `
    @if (available() || value() === 'letter') {
      <fpc-form-field
        [forId]="controlId()"
        i18n-label="@@featureDeliveryPreference-label"
        label="Preferred delivery"
        [hint]="available() ? hint : unavailableHint"
      >
        <fpc-form-control
          controlType="select"
          [controlId]="controlId()"
          [name]="controlId()"
          [disabled]="disabled()"
          [ngModel]="value()"
          (ngModelChange)="value.set($event)"
          [attr.data-testid]="controlId()"
        >
          <option value="email" i18n="@@featureDeliveryPreference-email">Email</option>
          <option value="letter" [disabled]="!available()" i18n="@@featureDeliveryPreference-letter">
            Email and letter by post
          </option>
        </fpc-form-control>
      </fpc-form-field>
    }
  `,
})
export class DeliveryPreferenceFieldComponent {
  /** Control id / name (unique per page). */
  readonly controlId = input('preferredDeliveryChannel');
  /** Letters can be chosen (the tenant has a configured postal provider). */
  readonly available = input(false);
  readonly disabled = input(false);
  readonly value = model<CustomerDeliveryPreference>('email');

  readonly hint = $localize`:@@featureDeliveryPreference-hint:With letters, invoices, credit notes and offers are also posted to the billing address; the email is still sent.`;
  readonly unavailableHint = $localize`:@@featureDeliveryPreference-unavailable:Letters are currently not available; documents are only emailed.`;
}
