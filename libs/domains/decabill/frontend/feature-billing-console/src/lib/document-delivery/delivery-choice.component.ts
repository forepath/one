import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { FpcFormCheckComponent, FpcFormCheckGroupComponent } from '@forepath/shared/frontend/ui-components';

/** How a document goes out: emailed, posted as a letter (postal provider) or not sent yet. */
export type DeliveryChoice = 'email' | 'letter' | 'none';

/**
 * Delivery channel of a document send (send dialogs) or of a finalizing action (issue, void, archive, bill time).
 * Letters are offered only when the tenant has a postal provider configured; finalizing actions also offer "don't send
 * yet" (the document can be sent or marked as sent later).
 */
@Component({
  selector: 'framework-delivery-choice',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FpcFormCheckGroupComponent, FpcFormCheckComponent],
  template: `
    <fpc-form-check-group
      [legendId]="idPrefix() + 'Legend'"
      i18n-label="@@featureDeliveryChoice-label"
      label="Send to the customer"
    >
      <fpc-form-check
        type="radio"
        [name]="idPrefix()"
        [checkId]="idPrefix() + '_email'"
        value="email"
        [checked]="value() === 'email'"
        (valueSelect)="value.set('email')"
        i18n-label="@@featureDeliveryChoice-email"
        label="By email (PDF attached)"
        [attr.data-testid]="idPrefix() + '-email'"
      />
      @if (postalAvailable()) {
        <fpc-form-check
          type="radio"
          [name]="idPrefix()"
          [checkId]="idPrefix() + '_letter'"
          value="letter"
          [checked]="value() === 'letter'"
          (valueSelect)="value.set('letter')"
          i18n-label="@@featureDeliveryChoice-letter"
          label="As a letter (printed and posted)"
          i18n-hint="@@featureDeliveryChoice-letterHint"
          hint="Sent through the postal provider; postage is charged by the provider."
          [attr.data-testid]="idPrefix() + '-letter'"
        />
      }
      @if (allowNone()) {
        <fpc-form-check
          type="radio"
          [name]="idPrefix()"
          [checkId]="idPrefix() + '_none'"
          value="none"
          [checked]="value() === 'none'"
          (valueSelect)="value.set('none')"
          i18n-label="@@featureDeliveryChoice-none"
          label="Don't send yet"
          i18n-hint="@@featureDeliveryChoice-noneHint"
          hint="Send it later, or mark it as sent when you deliver it yourself."
          [attr.data-testid]="idPrefix() + '-none'"
        />
      }
    </fpc-form-check-group>
    @if (showSpoolHint()) {
      <p class="form-text pt-3 mt-0 mb-0" i18n="@@featureDeliveryChoice-spoolHint">
        Sending runs in the background; you can follow it on the Spooler page.
      </p>
    }
  `,
})
export class DeliveryChoiceComponent {
  /** Radio group name and id prefix (unique per page). */
  readonly idPrefix = input('deliveryChoice');
  readonly postalAvailable = input(false);
  /** Offer "don't send yet" (finalizing actions). */
  readonly allowNone = input(false);
  readonly value = model<DeliveryChoice>('email');

  readonly showSpoolHint = computed(() => this.value() !== 'none');
}
