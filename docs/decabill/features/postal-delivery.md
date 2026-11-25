# Postal delivery

Invoices, credit notes and offers can be sent to the customer as physical letters. Decabill builds a print-ready PDF and hands it to a postal provider, which prints, envelopes and posts it. The built-in provider is [Pingen](https://www.pingen.com); further providers can be added as plugins.

## Overview

- **Send as letter** is a third delivery channel next to email and **mark as sent** (sent outside Decabill). It applies to documents that were finalized without notification and are not sent yet: invoices, credit notes of voided invoices and archived offers. See [Invoices](./invoices.md#finalize-and-send) and [Offers](./offers.md#finalize-and-send).
- Letters are sent through the [Spooler](./spooler.md): the document counts as sent (`sentVia: letter`) as soon as the request returns, and the spool job submits the letter in the background.
- The provider reports the letter's progress through signed webhooks. A letter the provider cannot process releases the document again; letters that need attention appear in the [Action Center](./action-center.md).
- Everything is configured per tenant (console **Administration → Settings → Postal delivery**), so each tenant can use its own provider account.

`GET /admin/billing/capabilities` returns `postalDelivery: { available, provider, providerName }`; `available` is `true` when the tenant's default provider is registered and configured.

## Requirements per letter

Checked before the document is claimed (400, nothing sent):

- Postal delivery configured for the tenant (see [Pingen setup](#pingen-setup))
- Complete issuer (`BILLING_ISSUER_*`): name and address are the return address
- The customer's billing profile has a complete postal address: company and / or first and last name, address line 1, postal code, city and a two-letter country code (address line 2 is optional)
- The document can be sent: finalized, not sent yet, offers not past their expiry date

Letters cost money, so personal access tokens need the scope `letters:admin` in addition to `invoices:admin` / `offers:admin` for the send-letter endpoints:

| Endpoint                                                              | Scopes                            |
| --------------------------------------------------------------------- | --------------------------------- |
| `POST /admin/billing/invoices/{invoiceRefId}/send-letter`             | `invoices:admin`, `letters:admin` |
| `POST /admin/billing/invoices/{invoiceRefId}/send-credit-note-letter` | `invoices:admin`, `letters:admin` |
| `POST /admin/billing/offers/{id}/send-letter`                         | `offers:admin`, `letters:admin`   |

## The letter

The letter PDF consists of:

1. **Cover page** (unless `BILLING_POSTAL_COVER_PAGE=false`): the document logo (when configured, see [Document branding](./document-branding.md)), the recipient address placed exactly in the envelope window (with a return-address line above it, except for providers that print their own postage and sender block there, such as Pingen), the document type, number and date, a short note ("Please find the invoice … enclosed.") and a footer with the issuer's name, VAT ID and email. The brand color is used for the document title only.
2. **The stored document**, unchanged (embedded e-invoice data included).
3. **Attachments**: the time report of a project invoice.

The window position follows `BILLING_POSTAL_ADDRESS_POSITION`:

| Value            | Envelope                           | Address window                                       |
| ---------------- | ---------------------------------- | ---------------------------------------------------- |
| `left` (default) | DIN 5008 form B (EU)               | 20 mm from the left, 45 mm from the top, 85 x 45 mm  |
| `right`          | Swiss window envelope (C5/4 right) | 118 mm from the left, 50 mm from the top, 85 x 40 mm |

In the left window the address starts 61 mm from the top and holds up to six lines (about 24 mm), inside Pingen's validated address area (22 mm from the left, 60 mm from the top, 85.5 x 25.3 mm). Pingen reserves the zone above it (postage area 20/40 mm, 89.5 x 47.5 mm) for its postage imprint and sender line; anything else printed there fails Pingen's inspection with `protected_stamp_area`.

Decabill's documents print issuer and customer side by side, so without the cover page the provider would not find the address in the window. Keep the cover page enabled unless your provider reads the address differently.

The address block lists the name lines, street lines and postal code with city; the country is added in capitals when the letter leaves the issuer's country. Lines are cut at the width of the window.

**Duplex printing** (`PINGEN_PRINT_MODE=duplex`): every part starts on a new sheet. A blank back side is inserted after the cover page and after a document with an odd page count before its attachments, so the document never starts on the back of the cover page.

## Letter lifecycle

Each submitted letter is recorded (`billing_postal_letters`) with the provider's letter id, and its status follows the provider's webhooks. Statuses only move forward; late or replayed events are ignored.

| Status            | Meaning                                                             | Effect on the document                                                                   |
| ----------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `submitted`       | Accepted by the provider (validated, printed and posted afterwards) | Counts as sent (`sentVia: letter`)                                                       |
| `action_required` | The provider could not process it (e.g. address not recognized)     | Released: shows as unsent again and can be sent another way; listed in the action center |
| `sent`            | Handed over to the postal service                                   | Sent; if it was released after `action_required`, claimed again (when still unsent)      |
| `delivered`       | Delivery confirmed (only some delivery products report it)          | Sent (claimed again as for `sent`)                                                       |
| `undeliverable`   | Returned or could not be delivered                                  | Stays sent; listed in the action center                                                  |
| `cancelled`       | Cancelled at the provider                                           | Released: shows as unsent again                                                          |

A release only applies while the document is still claimed by this letter: if it was sent another way in the meantime, the letter does not touch it. Every status change is written to the document's audit log (`postal_letter.status`, level `warn` for `action_required` and `undeliverable`); the submission is logged as `postal_letter.submit` and the send as `invoice.send_letter`, `invoice.void_document_send_letter` or `offer.send_letter`.

**Submission failures.** Network errors, timeouts, rate limits and provider errors (HTTP 5xx) are retried by the spooler (3 attempts). A rejection by the provider (for example invalid credentials or a document the provider refuses) fails the spool job right away with the provider's reason; the document is released. Fix the cause and retry the job on the Spooler page, or send the document another way.

The action center lists letters in `action_required` or `undeliverable` as `decabill.letters.attention` (Receivables, PAT scope `letters:admin`).

## Pingen setup

1. **Create an API app** in Pingen (organisation settings, API) with the grant type **client credentials** and the scope `letter`. The `webhook` scope is optional: Decabill does not manage webhooks through the API, so it is only needed if you want to manage them with these credentials yourself. Note the **client id** and **client secret**.
2. Note the **organisation id** (a UUID) of the Pingen organisation the letters should be billed to.
3. **Choose the environment.** Pingen's staging system has its own accounts and credentials; letters sent there are validated but never printed or posted. Use `PINGEN_ENVIRONMENT=staging` with staging credentials to test, `production` for real letters.
4. **Register the webhook** in Pingen for the event categories **issues**, **sent**, **undeliverable** and **delivered**, with the URL `https://<billing-host>/api/webhooks/postal/pingen` and a signing key of 20 to 32 letters and digits.
5. Enter the values under **Administration → Settings → Postal delivery** for the tenant:

| Setting                           | Value                                                                                                                       |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `BILLING_DEFAULT_POSTAL_PROVIDER` | `pingen` (default)                                                                                                          |
| `PINGEN_ENVIRONMENT`              | `production` (default) or `staging`                                                                                         |
| `PINGEN_CLIENT_ID`                | Client id of the API app                                                                                                    |
| `PINGEN_CLIENT_SECRET`            | Client secret of the API app                                                                                                |
| `PINGEN_ORGANISATION_ID`          | Organisation UUID                                                                                                           |
| `PINGEN_WEBHOOK_SIGNING_KEY`      | The webhook's signing key                                                                                                   |
| `PINGEN_DELIVERY_PRODUCT`         | `cheap` (default), `fast`, `bulk`, `premium` or `registered`; Pingen picks the matching product for the destination country |
| `PINGEN_PRINT_MODE`               | `simplex` (default) or `duplex`                                                                                             |
| `PINGEN_PRINT_SPECTRUM`           | `grayscale` (default) or `color`                                                                                            |
| `BILLING_POSTAL_COVER_PAGE`       | `true` (default)                                                                                                            |
| `BILLING_POSTAL_ADDRESS_POSITION` | `left` (default) or `right`                                                                                                 |

Letters become available as soon as client id, client secret and a valid organisation id are set. Letters are created with automatic sending, so Pingen validates, prints and posts them without a manual release in the Pingen app. Costs are charged by Pingen to the organisation.

**Webhooks.** The webhook endpoint is public. Decabill resolves the letter (and with it the tenant) from the letter id in the event, then verifies the `Signature` header (HMAC-SHA256 of the raw body, hex) with that tenant's `PINGEN_WEBHOOK_SIGNING_KEY` before applying anything. A wrong or missing signature, or a tenant without a signing key, is answered with 401. Events for letters Decabill does not know (test events, letters created in the Pingen app) are acknowledged without effect. Without a working webhook, letters stay `submitted` and the document stays sent; problems reported by Pingen then do not reach Decabill.

Because the endpoint is shared, several tenants can point their Pingen webhooks at the same URL; each event is verified with the key of the tenant that sent the letter.

## Customer preference

Every billing profile has a **Preferred delivery** (`preferredDeliveryChannel`): `email` (default) or `letter` ("Email and letter by post"). Customers set it in their own billing profile, admins in **Customer profiles**. The choice is only offered while the tenant has a configured postal provider (`postalDeliveryAvailable` on the profile response, `postalDelivery.available` in the billing capabilities for admins); choosing `letter` is refused otherwise, and it needs a complete postal address (also on every later save while it is chosen). A preference set earlier stays visible when the provider is removed later, and documents are then only emailed.

With `letter`, every document that Decabill emails to the customer is **also** posted: invoices on issue (manual, automatic billing, bill-now, accepted offers, project time), credit notes on void, offers on archive, and the email sends from the row menus. The email is still sent. The letter is a supplementary spool job (`… by letter (customer preference)`):

- It never takes over the document's sent state, which belongs to the email; a letter the provider cannot process or deliver does not make the document unsent, but is listed in the action center.
- Documents finalized without notification ("Don't send yet") get no letter either; an explicit **As a letter** send stays a letter-only delivery.
- When letters are unavailable at that moment (provider removed, address incomplete), the letter is skipped and the skip is recorded in the audit log (`postal_letter.preferred`).
- Partial credit documents (configuration changes, withdrawals) are emailed only.

## In the console

- **Administration → Settings → Postal delivery** holds the provider settings of the tenant (secrets are write-only).
- As soon as the default provider is configured, every send dialog (invoice, credit note, offer) offers **By email** or **As a letter**, and the finalizing dialogs (issue, void, archive offer, bill project time) additionally offer **Don't send yet**. Without a provider the dialogs look as before (email only).
- **Mark as sent** in the row menus of invoices and offers records a delivery made outside Decabill (date of sending, not in the future and not before the document was finalized); nothing is sent.
- Letters run through the [Spooler](./spooler.md); failed jobs and letters the provider could not process or deliver show up in the [action center](./action-center.md).

## Custom providers

Further providers are loaded from packages listed in `DYNAMIC_POSTAL_PROVIDERS` and selected per tenant with `BILLING_DEFAULT_POSTAL_PROVIDER` (the provider type). Their webhooks arrive at `POST /api/webhooks/postal/{type}`. See [Dynamic Provider Plugins](./dynamic-provider-plugins.md#postal-providers).

## Related documentation

- **[Invoices](./invoices.md)** and **[Offers](./offers.md)** Delivery channels
- **[Spooler](./spooler.md)** Background sends, retry and cancel
- **[Action Center](./action-center.md)** Letters that need attention
- **[Environment Configuration](../deployment/environment-configuration.md#postal-delivery)** All postal settings
- **[Customer Profiles](./customer-profiles.md)** Postal address of the customer
