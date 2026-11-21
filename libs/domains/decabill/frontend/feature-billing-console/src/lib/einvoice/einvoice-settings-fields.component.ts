import { Component, computed, input, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { BillingEinvoiceFormatOption } from '@forepath/decabill/frontend/data-access-billing-console';
import { FpcFormControlComponent, FpcFormFieldComponent } from '@forepath/shared/frontend/ui-components';

import {
  EINVOICE_BUYER_REFERENCE_MAX_LENGTH,
  einvoiceFormatRequiresBuyerReference,
  einvoiceFormatRequiresEndpoint,
  getEinvoiceFormatLabel,
  isEinvoiceEndpointValid,
} from './einvoice-settings.util';

/**
 * E-invoice settings of a customer profile: format override (empty = issuer default), buyer reference (BT-10 /
 * Leitweg-ID) and electronic address (`scheme:id`). The format select is shown only when `formats` are known
 * (admin capabilities); the customer self-service form shows the reference and endpoint only.
 */
@Component({
  selector: 'framework-einvoice-settings-fields',
  standalone: true,
  imports: [FormsModule, FpcFormFieldComponent, FpcFormControlComponent],
  template: `
    @if (formats().length > 0) {
      <fpc-form-field
        [forId]="prefix() + 'EinvoiceFormat'"
        i18n-label="@@featureEinvoice-formatLabel"
        label="E-invoice format"
        [hint]="formatHint()"
      >
        <fpc-form-control
          controlType="select"
          [controlId]="prefix() + 'EinvoiceFormat'"
          [name]="prefix() + 'EinvoiceFormat'"
          [disabled]="disabled()"
          [ngModel]="format() ?? ''"
          (ngModelChange)="format.set($event || null)"
          data-testid="einvoice-format-select"
        >
          <option value="">{{ issuerDefaultLabel() }}</option>
          @for (option of formats(); track option.format) {
            <option [value]="option.format">{{ option.label }}</option>
          }
        </fpc-form-control>
      </fpc-form-field>
    }
    <div class="row">
      <div class="col-md-6">
        <fpc-form-field
          [forId]="prefix() + 'BuyerReference'"
          i18n-label="@@featureEinvoice-buyerReferenceLabel"
          label="Buyer reference / Leitweg-ID"
          [hint]="buyerReferenceHint()"
        >
          <fpc-form-control
            [controlId]="prefix() + 'BuyerReference'"
            [name]="prefix() + 'BuyerReference'"
            [maxLength]="buyerReferenceMaxLength"
            [disabled]="disabled()"
            autocomplete="off"
            [ngModel]="buyerReference() ?? ''"
            (ngModelChange)="buyerReference.set($event)"
          />
        </fpc-form-field>
      </div>
      <div class="col-md-6">
        <fpc-form-field
          [forId]="prefix() + 'EinvoiceEndpoint'"
          i18n-label="@@featureEinvoice-endpointLabel"
          label="E-invoice address (scheme:id)"
          [hint]="endpointHint()"
        >
          <fpc-form-control
            [controlId]="prefix() + 'EinvoiceEndpoint'"
            [name]="prefix() + 'EinvoiceEndpoint'"
            placeholder="0088:4012345000009"
            [disabled]="disabled()"
            [invalid]="!endpointValid()"
            autocomplete="off"
            [ngModel]="endpoint() ?? ''"
            (ngModelChange)="endpoint.set($event)"
          />
        </fpc-form-field>
      </div>
    </div>
  `,
})
export class EinvoiceSettingsFieldsComponent {
  /** Control id prefix (unique per page). */
  readonly prefix = input('profile');
  readonly formats = input<readonly BillingEinvoiceFormatOption[]>([]);
  readonly defaultFormat = input<string | null>(null);
  readonly disabled = input(false);

  readonly format = model<string | null | undefined>(null);
  readonly buyerReference = model<string | null | undefined>(null);
  readonly endpoint = model<string | null | undefined>(null);

  readonly buyerReferenceMaxLength = EINVOICE_BUYER_REFERENCE_MAX_LENGTH;

  /** The format invoices will use: the override, else the issuer default. */
  readonly effectiveFormat = computed(() => this.format() || this.defaultFormat());

  readonly issuerDefaultLabel = computed(() => {
    const label = getEinvoiceFormatLabel(this.defaultFormat(), this.formats());

    return label
      ? $localize`:@@featureEinvoice-issuerDefault:Issuer default (${label}:format:)`
      : $localize`:@@featureEinvoice-issuerDefaultUnknown:Issuer default`;
  });

  readonly formatHint = computed(() =>
    einvoiceFormatRequiresBuyerReference(this.effectiveFormat())
      ? $localize`:@@featureEinvoice-formatHintXrechnung:XRechnung needs a buyer reference (Leitweg-ID for German public buyers) and an e-invoice address.`
      : einvoiceFormatRequiresEndpoint(this.effectiveFormat())
        ? $localize`:@@featureEinvoice-formatHintPeppol:Peppol needs the customer's e-invoice address (scheme:id).`
        : $localize`:@@featureEinvoice-formatHint:Structured invoice data embedded in or sent with every invoice of this customer.`,
  );

  readonly buyerReferenceHint = computed(() =>
    einvoiceFormatRequiresBuyerReference(this.effectiveFormat())
      ? $localize`:@@featureEinvoice-buyerReferenceRequired:Required for XRechnung: the Leitweg-ID or the reference the buyer gave you.`
      : $localize`:@@featureEinvoice-buyerReferenceHint:Optional reference of the buyer (BT-10), printed on the invoice.`,
  );

  readonly endpointValid = computed(() => isEinvoiceEndpointValid(this.endpoint()));

  readonly endpointHint = computed(() =>
    !this.endpointValid()
      ? $localize`:@@featureEinvoice-endpointInvalid:Use scheme:id, e.g. 0088:4012345000009 (GLN) or 9930:DE123456789 (VAT ID).`
      : einvoiceFormatRequiresEndpoint(this.effectiveFormat())
        ? $localize`:@@featureEinvoice-endpointRequired:Required for Peppol / XRechnung; defaults to the VAT ID when empty.`
        : $localize`:@@featureEinvoice-endpointHint:Optional electronic address (Peppol participant ID).`,
  );
}
