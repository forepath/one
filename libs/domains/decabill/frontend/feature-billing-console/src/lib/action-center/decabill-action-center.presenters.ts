import type { ActionCenterItem } from '@forepath/shared/frontend/data-access-action-center';
import {
  paramText,
  type ActionCenterFormat,
  type ActionCenterLink,
  type ActionCenterPresenter,
  type ActionCenterPresenterSet,
} from '@forepath/shared/frontend/feature-action-center';

/** Comma-joined non-empty parts (meta lines). */
function joinParts(...parts: Array<string | null | undefined>): string | null {
  const present = parts.filter((part): part is string => !!part && part.trim().length > 0);

  return present.length > 0 ? present.join(', ') : null;
}

function money(item: ActionCenterItem, format: ActionCenterFormat, key = 'totalGross'): string {
  return paramText(item.params, key)
    ? format.money(paramText(item.params, key), paramText(item.params, 'currency'))
    : '';
}

const link = (commands: readonly unknown[], queryParams?: ActionCenterLink['queryParams']): ActionCenterLink => ({
  commands,
  queryParams,
});
const INVOICES = ['/administration/billing'];
const OFFERS = ['/administration/offers'];
const SETTINGS = ['/administration/settings'];
const ACCOUNTING = ['/administration/accounting'];
/** Search a customer invoice by number on the billing page. */
const invoiceLink = (item: ActionCenterItem) =>
  paramText(item.params, 'number') ? link(INVOICES, { 'inv-q': paramText(item.params, 'number') }) : link(INVOICES);
/** Search a supplier invoice by number in the supplier perspective. */
const payableLink = (item: ActionCenterItem) =>
  link(INVOICES, {
    perspective: 'supplier',
    ...(paramText(item.params, 'number') ? { 'sinv-q': paramText(item.params, 'number') } : {}),
  });
const offerLink = (item: ActionCenterItem) =>
  paramText(item.params, 'number') ? link(OFFERS, { 'off-q': paramText(item.params, 'number') }) : link(OFFERS);
const invoiceItem: Pick<ActionCenterPresenter, 'itemTitle' | 'itemMeta' | 'itemLink'> = {
  itemTitle: (item) => paramText(item.params, 'number'),
  itemMeta: (item, format) => joinParts(paramText(item.params, 'customer'), money(item, format)),
  itemLink: invoiceLink,
};
const offerItem: Pick<ActionCenterPresenter, 'itemTitle' | 'itemMeta' | 'itemLink'> = {
  itemTitle: (item) => paramText(item.params, 'number'),
  itemMeta: (item, format) => joinParts(paramText(item.params, 'customer'), money(item, format)),
  itemLink: offerLink,
};
const subscriptionItem: Pick<ActionCenterPresenter, 'itemTitle' | 'itemMeta'> = {
  itemTitle: (item) =>
    joinParts(paramText(item.params, 'number'), paramText(item.params, 'label')) ?? paramText(item.params, 'customer'),
  itemMeta: (item) => joinParts(paramText(item.params, 'customer'), paramText(item.params, 'error')),
};
const bankItem: Pick<ActionCenterPresenter, 'itemTitle' | 'itemMeta'> = {
  itemTitle: (item, format) =>
    joinParts(
      format.money(paramText(item.params, 'amount'), paramText(item.params, 'currency')),
      paramText(item.params, 'counterparty'),
    ) ?? '',
  itemMeta: (item, format) =>
    joinParts(format.date(paramText(item.params, 'bookingDate')), paramText(item.params, 'remittance')),
};

/** Presenters of the Decabill item types (see `DECABILL_ACTION_TYPES` in the billing manager). */
export function decabillActionCenterPresenters(): ActionCenterPresenterSet {
  const setUp = $localize`:@@featureActionCenter-setUp:Set up`;

  return {
    categories: {
      receivables: $localize`:@@featureBillingActionCenter-categoryReceivables:Receivables`,
      offers: $localize`:@@featureBillingActionCenter-categoryOffers:Offers`,
      payables: $localize`:@@featureBillingActionCenter-categoryPayables:Payables`,
      customers: $localize`:@@featureBillingActionCenter-categoryCustomers:Customers`,
      subscriptions: $localize`:@@featureBillingActionCenter-categorySubscriptions:Subscriptions`,
      inventory: $localize`:@@featureBillingActionCenter-categoryInventory:Inventory`,
      accounting: $localize`:@@featureBillingActionCenter-categoryAccounting:Accounting`,
    },
    types: {
      // --- setup ---------------------------------------------------------------------------------------------------
      'decabill.setup.issuer': {
        icon: 'building-gear',
        title: $localize`:@@featureBillingActionCenter-setupIssuerTitle:Complete your company details`,
        description: $localize`:@@featureBillingActionCenter-setupIssuerDescription:Name, VAT ID and address are printed on every invoice; documents cannot be issued without them.`,
        link: () => link(SETTINGS),
        actionLabel: setUp,
      },
      'decabill.setup.issuer_details': {
        icon: 'bank',
        title: $localize`:@@featureBillingActionCenter-setupIssuerDetailsTitle:Add payment and contact details`,
        description: $localize`:@@featureBillingActionCenter-setupIssuerDetailsDescription:Email, IBAN and BIC tell customers how to reach and pay you.`,
        link: () => link(SETTINGS),
        actionLabel: setUp,
      },
      'decabill.setup.accounting': {
        icon: 'journal-bookmark',
        title: $localize`:@@featureBillingActionCenter-setupAccountingTitle:Finish the accounting setup`,
        description: (group) =>
          $localize`:@@featureBillingActionCenter-setupAccountingDescription:Accounting is switched on but cannot start yet. Missing: ${paramText(group.params, 'missing')}:missing:`,
        link: () => link(SETTINGS),
        actionLabel: setUp,
      },
      'decabill.setup.datev': {
        icon: 'file-earmark-spreadsheet',
        title: $localize`:@@featureBillingActionCenter-setupDatevTitle:Configure the DATEV export`,
        description: $localize`:@@featureBillingActionCenter-setupDatevDescription:DATEV exports are enabled, but the consultant and client numbers are missing. Configure them or switch the export off.`,
        link: () => link(SETTINGS),
        actionLabel: setUp,
      },
      'decabill.setup.first_customer': {
        icon: 'person-plus',
        title: $localize`:@@featureBillingActionCenter-setupFirstCustomerTitle:Add your first customer`,
        description: $localize`:@@featureBillingActionCenter-setupFirstCustomerDescription:Create a customer profile to send offers and invoices.`,
        link: () => link(['/administration/customer-profiles']),
        actionLabel: $localize`:@@featureBillingActionCenter-setupFirstCustomerAction:Add customer`,
      },
      // --- receivables ---------------------------------------------------------------------------------------------
      'decabill.invoices.unsent': {
        icon: 'send',
        title: $localize`:@@featureBillingActionCenter-invoicesUnsentTitle:Invoices not sent yet`,
        description: $localize`:@@featureBillingActionCenter-invoicesUnsentDescription:Issued without notifying the customer. Send them when ready.`,
        link: () => link(INVOICES),
        ...invoiceItem,
      },
      'decabill.invoices.credit_note_unsent': {
        icon: 'receipt-cutoff',
        title: $localize`:@@featureBillingActionCenter-creditNotesUnsentTitle:Credit notes not sent yet`,
        description: $localize`:@@featureBillingActionCenter-creditNotesUnsentDescription:Voided invoices whose credit note the customer has not received.`,
        link: () => link(INVOICES),
        ...invoiceItem,
      },
      'decabill.invoices.draft': {
        icon: 'file-earmark-text',
        title: $localize`:@@featureBillingActionCenter-invoicesDraftTitle:Draft invoices`,
        description: $localize`:@@featureBillingActionCenter-invoicesDraftDescription:Review and issue or discard them.`,
        link: () => link(INVOICES),
        ...invoiceItem,
        itemTitle: (item) => paramText(item.params, 'number') || paramText(item.params, 'customer'),
      },
      'decabill.invoices.overdue': {
        icon: 'alarm',
        title: $localize`:@@featureBillingActionCenter-invoicesOverdueTitle:Overdue invoices`,
        description: $localize`:@@featureBillingActionCenter-invoicesOverdueDescription:Payment is past due. Remind the customer or record the payment.`,
        link: () => link(INVOICES),
        ...invoiceItem,
        itemMeta: (item, format) =>
          joinParts(
            paramText(item.params, 'customer'),
            money(item, format, 'balanceDue'),
            paramText(item.params, 'dueDate')
              ? $localize`:@@featureBillingActionCenter-dueSince:due ${format.date(paramText(item.params, 'dueDate'))}:date:`
              : null,
          ),
      },
      'decabill.invoices.auto_payment_exhausted': {
        icon: 'credit-card-2-back',
        title: $localize`:@@featureBillingActionCenter-autoPaymentTitle:Automatic payment failed`,
        description: $localize`:@@featureBillingActionCenter-autoPaymentDescription:All automatic collection attempts failed. Contact the customer or collect manually.`,
        link: () => link(INVOICES),
        ...invoiceItem,
      },
      // --- offers ----------------------------------------------------------------------------------------------------
      'decabill.offers.draft': {
        icon: 'file-earmark-plus',
        title: $localize`:@@featureBillingActionCenter-offersDraftTitle:Draft offers`,
        description: $localize`:@@featureBillingActionCenter-offersDraftDescription:Finish and finalize them so customers can accept.`,
        link: () => link(OFFERS),
        ...offerItem,
        itemTitle: (item) => paramText(item.params, 'number') || paramText(item.params, 'customer'),
      },
      'decabill.offers.unsent': {
        icon: 'send',
        title: $localize`:@@featureBillingActionCenter-offersUnsentTitle:Offers not sent yet`,
        description: $localize`:@@featureBillingActionCenter-offersUnsentDescription:Finalized without notifying the customer. Send them before they expire.`,
        link: () => link(OFFERS),
        ...offerItem,
      },
      'decabill.offers.expiring': {
        icon: 'hourglass-split',
        title: $localize`:@@featureBillingActionCenter-offersExpiringTitle:Offers expiring soon`,
        description: $localize`:@@featureBillingActionCenter-offersExpiringDescription:Open offers expire within a week. Follow up with the customer.`,
        link: () => link(OFFERS),
        ...offerItem,
        itemMeta: (item, format) =>
          joinParts(
            paramText(item.params, 'customer'),
            paramText(item.params, 'dueDate')
              ? $localize`:@@featureBillingActionCenter-expiresOn:expires ${format.date(paramText(item.params, 'dueDate'))}:date:`
              : null,
          ),
      },
      'decabill.offers.fulfillment_failed': {
        icon: 'exclamation-octagon',
        title: $localize`:@@featureBillingActionCenter-fulfillmentFailedTitle:Accepted offers not fulfilled`,
        description: $localize`:@@featureBillingActionCenter-fulfillmentFailedDescription:Positions of accepted offers could not be fulfilled automatically.`,
        link: () => link(OFFERS),
        itemTitle: (item) => joinParts(paramText(item.params, 'number'), paramText(item.params, 'description')) ?? '',
        itemMeta: (item) => paramText(item.params, 'customer') || null,
        itemLink: offerLink,
      },
      // --- payables ----------------------------------------------------------------------------------------------------
      'decabill.payables.draft': {
        icon: 'file-earmark-arrow-down',
        title: $localize`:@@featureBillingActionCenter-payablesDraftTitle:Draft supplier invoices`,
        description: $localize`:@@featureBillingActionCenter-payablesDraftDescription:Complete and record them so they are paid and booked.`,
        link: () => link(INVOICES, { perspective: 'supplier' }),
        itemTitle: (item) => paramText(item.params, 'number') || paramText(item.params, 'supplier'),
        itemMeta: (item, format) => joinParts(paramText(item.params, 'supplier'), money(item, format)),
        itemLink: payableLink,
      },
      'decabill.payables.due': {
        icon: 'cash-coin',
        title: $localize`:@@featureBillingActionCenter-payablesDueTitle:Supplier invoices to pay`,
        description: $localize`:@@featureBillingActionCenter-payablesDueDescription:Due within three days or already overdue.`,
        link: () => link(INVOICES, { perspective: 'supplier' }),
        itemTitle: (item) => paramText(item.params, 'number') || paramText(item.params, 'supplier'),
        itemMeta: (item, format) =>
          joinParts(
            paramText(item.params, 'supplier'),
            money(item, format, 'balanceDue'),
            paramText(item.params, 'dueDate')
              ? item.params['overdue'] === true
                ? $localize`:@@featureBillingActionCenter-overdueSince:overdue since ${format.date(paramText(item.params, 'dueDate'))}:date:`
                : $localize`:@@featureBillingActionCenter-dueOn:due ${format.date(paramText(item.params, 'dueDate'))}:date:`
              : null,
          ),
        itemLink: payableLink,
      },
      'decabill.payables.missing_document': {
        icon: 'paperclip',
        title: $localize`:@@featureBillingActionCenter-payablesMissingDocumentTitle:Receipts missing`,
        description: $localize`:@@featureBillingActionCenter-payablesMissingDocumentDescription:Supplier invoices without the original document. Upload it for your records.`,
        link: () => link(INVOICES, { perspective: 'supplier' }),
        itemTitle: (item) => paramText(item.params, 'number') || paramText(item.params, 'supplier'),
        itemMeta: (item, format) => joinParts(paramText(item.params, 'supplier'), money(item, format)),
        itemLink: payableLink,
      },
      // --- customers / suppliers -----------------------------------------------------------------------------------
      'decabill.customers.incomplete': {
        icon: 'person-exclamation',
        title: $localize`:@@featureBillingActionCenter-customersIncompleteTitle:Incomplete billing profiles`,
        description: $localize`:@@featureBillingActionCenter-customersIncompleteDescription:Customers with business but missing name, email or address. Invoices and automatic payments wait for them.`,
        link: () => link(['/administration/customer-profiles']),
        itemTitle: (item) => paramText(item.params, 'name') || paramText(item.params, 'number'),
        itemMeta: (item) => paramText(item.params, 'number') || null,
        itemLink: (item) =>
          link(['/administration/customer-profiles'], {
            q: paramText(item.params, 'number') || paramText(item.params, 'name') || undefined,
          }),
      },
      'decabill.customers.vat_invalid': {
        icon: 'patch-exclamation',
        title: $localize`:@@featureBillingActionCenter-vatInvalidTitle:Invalid VAT IDs`,
        description: $localize`:@@featureBillingActionCenter-vatInvalidDescription:The VAT ID check failed. Correct it to apply the right tax treatment.`,
        link: () => link(['/administration/customer-profiles']),
        itemTitle: (item) => paramText(item.params, 'name') || paramText(item.params, 'number'),
        itemMeta: (item) => joinParts(paramText(item.params, 'vatId'), paramText(item.params, 'number')),
        itemLink: (item) =>
          link(
            [
              item.params['kind'] === 'supplier'
                ? '/administration/supplier-profiles'
                : '/administration/customer-profiles',
            ],
            { q: paramText(item.params, 'number') || undefined },
          ),
      },
      'decabill.suppliers.incomplete': {
        icon: 'truck',
        title: $localize`:@@featureBillingActionCenter-suppliersIncompleteTitle:Incomplete supplier profiles`,
        description: $localize`:@@featureBillingActionCenter-suppliersIncompleteDescription:Name or address is missing; DATEV creditor data and documents need them.`,
        link: () => link(['/administration/supplier-profiles']),
        itemTitle: (item) => paramText(item.params, 'name') || paramText(item.params, 'number'),
        itemMeta: (item) => paramText(item.params, 'number') || null,
        itemLink: (item) =>
          link(['/administration/supplier-profiles'], { q: paramText(item.params, 'number') || undefined }),
      },
      // --- subscriptions ------------------------------------------------------------------------------------------------
      'decabill.subscriptions.provisioning_failed': {
        icon: 'hdd-network',
        title: $localize`:@@featureBillingActionCenter-provisioningFailedTitle:Provisioning failed`,
        description: $localize`:@@featureBillingActionCenter-provisioningFailedDescription:Servers of active subscriptions could not be created.`,
        link: () => link(['/administration/subscriptions']),
        ...subscriptionItem,
        itemLink: (item) =>
          paramText(item.params, 'subscriptionId')
            ? link([
                '/administration/subscriptions',
                paramText(item.params, 'subscriptionId'),
                'services',
                item.id,
                'details',
              ])
            : link(['/administration/subscriptions']),
      },
      'decabill.subscriptions.addon_failed': {
        icon: 'puzzle',
        title: $localize`:@@featureBillingActionCenter-addonFailedTitle:Add-ons failed`,
        description: $localize`:@@featureBillingActionCenter-addonFailedDescription:Add-ons of active subscriptions could not be activated.`,
        link: () => link(['/administration/subscriptions']),
        ...subscriptionItem,
      },
      'decabill.subscriptions.config_change_failed': {
        icon: 'sliders',
        title: $localize`:@@featureBillingActionCenter-configChangeFailedTitle:Configuration changes failed`,
        description: $localize`:@@featureBillingActionCenter-configChangeFailedDescription:Requested plan or configuration changes were not applied.`,
        link: () => link(['/administration/subscriptions']),
        ...subscriptionItem,
      },
      'decabill.subscriptions.backorder_failed': {
        icon: 'box-seam',
        title: $localize`:@@featureBillingActionCenter-backorderFailedTitle:Backorders failed`,
        description: $localize`:@@featureBillingActionCenter-backorderFailedDescription:Orders waiting for capacity could not be fulfilled.`,
        link: () => link(['/administration/subscriptions']),
        itemTitle: (item) => joinParts(paramText(item.params, 'customer'), paramText(item.params, 'plan')) ?? '',
        itemMeta: (item) => paramText(item.params, 'error') || null,
      },
      // --- inventory -----------------------------------------------------------------------------------------------------
      'decabill.inventory.withdrawal_pending': {
        icon: 'box-arrow-up-right',
        title: $localize`:@@featureBillingActionCenter-withdrawalPendingTitle:Withdrawal requests to decide`,
        description: $localize`:@@featureBillingActionCenter-withdrawalPendingDescription:Accept or reject requested stock withdrawals.`,
        link: () => link(['/administration/inventory/requests']),
        itemTitle: (item) =>
          joinParts(paramText(item.params, 'quantity') + ' x', paramText(item.params, 'article')) ?? '',
        itemMeta: (item) => joinParts(paramText(item.params, 'articleNumber'), paramText(item.params, 'source')),
      },
      'decabill.inventory.lending_overdue': {
        icon: 'arrow-return-left',
        title: $localize`:@@featureBillingActionCenter-lendingOverdueTitle:Lent items not returned`,
        description: $localize`:@@featureBillingActionCenter-lendingOverdueDescription:The return date has passed.`,
        link: () => link(['/administration/inventory/lendings']),
        itemTitle: (item) => joinParts(paramText(item.params, 'number'), paramText(item.params, 'article')) ?? '',
        itemMeta: (item, format) =>
          joinParts(
            paramText(item.params, 'borrower'),
            paramText(item.params, 'dueDate')
              ? $localize`:@@featureBillingActionCenter-dueSince:due ${format.date(paramText(item.params, 'dueDate'))}:date:`
              : null,
          ),
        itemLink: (item) =>
          link(['/administration/inventory/lendings'], { 'lnd-q': paramText(item.params, 'number') || undefined }),
      },
      'decabill.inventory.low_stock': {
        icon: 'box2',
        title: $localize`:@@featureBillingActionCenter-lowStockTitle:Low stock`,
        description: $localize`:@@featureBillingActionCenter-lowStockDescription:Articles at or below their reorder point. Reorder in time.`,
        link: () => link(['/administration/inventory/articles']),
        itemTitle: (item) => paramText(item.params, 'article'),
        itemMeta: (item) =>
          $localize`:@@featureBillingActionCenter-lowStockMeta:${paramText(item.params, 'articleNumber')}:number:, on hand ${paramText(item.params, 'onHand')}:onHand: (reorder at ${paramText(item.params, 'reorderPoint')}:reorderPoint:)`,
        itemLink: (item) => link(['/administration/inventory/articles', item.id]),
      },
      // --- accounting ----------------------------------------------------------------------------------------------------
      'decabill.accounting.unbooked_documents': {
        icon: 'journal-x',
        title: $localize`:@@featureBillingActionCenter-unbookedTitle:Documents not booked`,
        description: $localize`:@@featureBillingActionCenter-unbookedDescription:Issued or voided documents without a ledger entry. Check the posting issues.`,
        link: () => link(ACCOUNTING),
        itemTitle: (item) => paramText(item.params, 'number'),
        itemMeta: (item, format) =>
          joinParts(
            item.params['kind'] === 'supplier_invoice'
              ? $localize`:@@featureBillingActionCenter-kindSupplierInvoice:Supplier invoice`
              : $localize`:@@featureBillingActionCenter-kindInvoice:Invoice`,
            money(item, format),
          ),
        itemLink: (item) => (item.params['kind'] === 'supplier_invoice' ? payableLink(item) : invoiceLink(item)),
      },
      'decabill.accounting.posting_issues': {
        icon: 'bug',
        title: $localize`:@@featureBillingActionCenter-postingIssuesTitle:Posting issues`,
        description: $localize`:@@featureBillingActionCenter-postingIssuesDescription:Automatic bookings failed (e.g. a missing account mapping). Fix the cause; they are retried.`,
        link: () => link(ACCOUNTING),
        itemTitle: (item) =>
          joinParts(paramText(item.params, 'sourceType'), paramText(item.params, 'sourceEvent')) ?? '',
        itemMeta: (item) => paramText(item.params, 'error') || null,
      },
      'decabill.accounting.bank_unmatched': {
        icon: 'bank2',
        title: $localize`:@@featureBillingActionCenter-bankUnmatchedTitle:Bank transactions to reconcile`,
        description: $localize`:@@featureBillingActionCenter-bankUnmatchedDescription:Booked transactions without a matching document.`,
        link: () => link([...ACCOUNTING, 'banking']),
        ...bankItem,
      },
      'decabill.accounting.bank_suggested': {
        icon: 'magic',
        title: $localize`:@@featureBillingActionCenter-bankSuggestedTitle:Matches to confirm`,
        description: $localize`:@@featureBillingActionCenter-bankSuggestedDescription:Bank transactions with a suggested match. Confirm or correct them.`,
        link: () => link([...ACCOUNTING, 'banking']),
        ...bankItem,
      },
      'decabill.accounting.bank_import_failed': {
        icon: 'file-earmark-x',
        title: $localize`:@@featureBillingActionCenter-bankImportFailedTitle:Bank imports failed`,
        description: $localize`:@@featureBillingActionCenter-bankImportFailedDescription:Statement files could not be imported. Check the file and import it again.`,
        link: () => link([...ACCOUNTING, 'banking']),
        itemTitle: (item) => paramText(item.params, 'fileName'),
        // Why it failed (e.g. no financial account for the statement's IBAN) and when it was uploaded.
        itemMeta: (item, format) =>
          joinParts(
            paramText(item.params, 'error'),
            paramText(item.params, 'format').toUpperCase(),
            item.occurredAt
              ? $localize`:@@featureBillingActionCenter-uploadedOn:uploaded ${format.date(item.occurredAt)}:date:`
              : null,
          ),
      },
      'decabill.accounting.vat_return_due': {
        icon: 'calendar-check',
        title: $localize`:@@featureBillingActionCenter-vatReturnDueTitle:VAT returns to file`,
        description: $localize`:@@featureBillingActionCenter-vatReturnDueDescription:Draft returns of finished periods. Review, file and mark them as submitted.`,
        link: () => link([...ACCOUNTING, 'vat-returns']),
        itemTitle: (item, format) =>
          joinParts(
            paramText(item.params, 'definition'),
            `${format.date(paramText(item.params, 'periodStart'))} - ${format.date(paramText(item.params, 'periodEnd'))}`,
          ) ?? '',
        itemMeta: (item, format) =>
          paramText(item.params, 'resultAmount') ? format.money(paramText(item.params, 'resultAmount'), 'EUR') : null,
      },
      // --- delivery (spooler, letters) ------------------------------------------------------------------------------
      'decabill.spooler.failed': {
        icon: 'printer',
        title: $localize`:@@featureBillingActionCenter-spoolerFailedTitle:Printouts and sends failed`,
        description: $localize`:@@featureBillingActionCenter-spoolerFailedDescription:Background jobs that gave up. Retry them on the Spooler page; failed sends left their document unsent.`,
        link: () => link(['/administration/spooler']),
        itemTitle: (item) => paramText(item.params, 'title'),
        itemMeta: (item) => paramText(item.params, 'error') || null,
        itemLink: () => link(['/administration/spooler']),
      },
      'decabill.letters.attention': {
        icon: 'mailbox',
        title: $localize`:@@featureBillingActionCenter-lettersAttentionTitle:Letters need attention`,
        description: $localize`:@@featureBillingActionCenter-lettersAttentionDescription:The postal provider could not process or deliver these letters. Check the address and send the document again.`,
        link: () => link(INVOICES),
        itemTitle: (item) => paramText(item.params, 'number'),
        itemMeta: (item) =>
          joinParts(
            paramText(item.params, 'status') === 'undeliverable'
              ? $localize`:@@featureBillingActionCenter-letterUndeliverable:Undeliverable`
              : $localize`:@@featureBillingActionCenter-letterActionRequired:Needs action at the provider`,
            paramText(item.params, 'reason'),
          ),
        itemLink: (item) =>
          paramText(item.params, 'documentType') === 'offer'
            ? paramText(item.params, 'number')
              ? link(OFFERS, { 'off-q': paramText(item.params, 'number') })
              : link(OFFERS)
            : paramText(item.params, 'number')
              ? link(INVOICES, { 'inv-q': paramText(item.params, 'number').replace(/-CN$/, '') })
              : link(INVOICES),
      },
      'decabill.datev.export_failed': {
        icon: 'cloud-slash',
        title: $localize`:@@featureBillingActionCenter-datevFailedTitle:DATEV exports failed`,
        description: $localize`:@@featureBillingActionCenter-datevFailedDescription:Run the export of these periods again after fixing the cause.`,
        link: () => link(['/administration/datev-exports']),
        itemTitle: (item) => paramText(item.params, 'period'),
        itemMeta: (item) => paramText(item.params, 'error') || null,
      },
    },
  };
}

/** Where the shared platform items lead in the billing console. */
export const DECABILL_PLATFORM_ACTION_LINKS = {
  updates: link(['/updates']),
  webhooks: link(['/webhooks']),
  emailSettings: link(SETTINGS),
};
