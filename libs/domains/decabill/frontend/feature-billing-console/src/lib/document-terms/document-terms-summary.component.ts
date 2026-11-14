import { NgTemplateOutlet } from '@angular/common';
import { Component, Input } from '@angular/core';
import type { DocumentTerms } from '@forepath/decabill/frontend/data-access-billing-console';
import { FpcLaneHeaderComponent } from '@forepath/shared/frontend/ui-components';

import { formatDeliveryTermsLabel, formatPaymentTermsLabel } from './document-terms.util';

export type DocumentTermsSummaryLayout = 'card' | 'inline';

/** Read-only payment / delivery terms for invoice, offer and plan details. Renders nothing when no terms are set. */
@Component({
  selector: 'framework-document-terms-summary',
  standalone: true,
  imports: [NgTemplateOutlet, FpcLaneHeaderComponent],
  templateUrl: './document-terms-summary.component.html',
  styles: ['.document-terms-summary__text { white-space: pre-line; }'],
})
export class DocumentTermsSummaryComponent {
  @Input() terms: Partial<DocumentTerms> | null | undefined = null;
  @Input() layout: DocumentTermsSummaryLayout = 'card';

  get paymentTermsLabel(): string | undefined {
    return formatPaymentTermsLabel(this.terms?.paymentDueDays);
  }

  get deliveryTermsLabel(): string | undefined {
    return formatDeliveryTermsLabel({
      deliveryTermsCode: this.terms?.deliveryTermsCode ?? null,
      deliveryTermsPlace: this.terms?.deliveryTermsPlace ?? null,
      deliveryTermsText: this.terms?.deliveryTermsText ?? null,
    });
  }

  get hasTerms(): boolean {
    return Boolean(this.paymentTermsLabel || this.deliveryTermsLabel);
  }
}
