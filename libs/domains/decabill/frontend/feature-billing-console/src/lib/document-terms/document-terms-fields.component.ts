import { Component, Input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  DELIVERY_TERMS_PLACE_MAX_LENGTH,
  DELIVERY_TERMS_TEXT_MAX_LENGTH,
  PAYMENT_DUE_DAYS_MAX,
  type DocumentTerms,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { FpcFormControlComponent, FpcFormFieldComponent } from '@forepath/shared/frontend/ui-components';

import {
  formatDeliveryTermsLabel,
  getDeliveryTermsOptions,
  getDeliveryTermsPlaceError,
  getDeliveryTermsTextError,
  getPaymentDueDaysError,
  isIncotermCode,
  type DocumentTermsFormModel,
} from './document-terms.util';

/**
 * Payment terms (days) + delivery terms (Incoterms® 2020 rule with named place, or manual free text) for plan, offer
 * and manual-invoice forms. Mutates the passed form model like the surrounding template-driven forms.
 */
@Component({
  selector: 'framework-document-terms-fields',
  standalone: true,
  imports: [FormsModule, FpcFormFieldComponent, FpcFormControlComponent],
  templateUrl: './document-terms-fields.component.html',
})
export class DocumentTermsFieldsComponent {
  @Input({ required: true }) form!: DocumentTermsFormModel;
  /** Prefix for control ids (unique per page). */
  @Input() idPrefix = 'documentTerms';
  @Input() disabled = false;
  @Input() includePaymentTerms = true;
  /** Terms that apply when a field is left empty (plan / global default); null when not known up front. */
  @Input() inherited: Pick<
    DocumentTerms,
    'paymentDueDays' | 'deliveryTermsCode' | 'deliveryTermsPlace' | 'deliveryTermsText'
  > | null = null;

  readonly deliveryTermsOptions = getDeliveryTermsOptions();
  readonly paymentDueDaysMax = PAYMENT_DUE_DAYS_MAX;
  readonly placeMaxLength = DELIVERY_TERMS_PLACE_MAX_LENGTH;
  readonly textMaxLength = DELIVERY_TERMS_TEXT_MAX_LENGTH;

  get paymentDueDaysError(): string | null {
    return getPaymentDueDaysError(this.form);
  }

  get deliveryTermsTextError(): string | null {
    return getDeliveryTermsTextError(this.form);
  }

  get deliveryTermsPlaceError(): string | null {
    return getDeliveryTermsPlaceError(this.form);
  }

  get showPlace(): boolean {
    return isIncotermCode(this.form.deliveryTermsCode);
  }

  get showCustomText(): boolean {
    return this.form.deliveryTermsCode === 'CUSTOM';
  }

  get paymentDueDaysHint(): string {
    const days = this.inherited?.paymentDueDays;

    return days != null
      ? $localize`:@@featureDocumentTerms-paymentDueDaysHintDays:Default if empty: ${days}:days: days`
      : $localize`:@@featureDocumentTerms-paymentDueDaysHintPlan:Default if empty: plan or global`;
  }

  get inheritOptionLabel(): string {
    if (!this.inherited) {
      return $localize`:@@featureDocumentTerms-inheritOption:Default (service plan or global setting)`;
    }

    const inherited = formatDeliveryTermsLabel(this.inherited);

    return inherited
      ? $localize`:@@featureDocumentTerms-inheritOptionValue:Default: ${inherited}:terms:`
      : $localize`:@@featureDocumentTerms-inheritOptionNone:Default: none`;
  }
}
