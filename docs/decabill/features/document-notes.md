# Document notes

Administrators can add an optional free-text **note** to invoices, credit notes and offers. The note is printed on the PDF and, wherever the document carries structured data, embedded in the e-invoice XML. Documents without a note look exactly as before.

## Where a note is set

| Document                    | Set in                                                 | API field                                                                              |
| --------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Manual invoice              | Administration → Invoices → Create / Edit (draft)      | `note` on `POST /admin/billing/invoices/manual` and `POST /admin/billing/invoices/:id` |
| Project time invoice        | Project → Bill time dialog                             | `note` on `POST /admin/billing/projects/:projectId/bill-time`                          |
| Credit note (void document) | Administration → Invoices → Void (confirmation dialog) | `note` on `POST /admin/billing/invoices/:id/void`                                      |
| Offer                       | Administration → Offers → Create / Edit (draft)        | `note` on `POST` / `PUT /admin/billing/offers(/:id)`                                   |

Automatically generated documents carry no note: billing-day and bill-now invoices, invoices created when a customer accepts an offer, and partial credit notes (withdrawals, configuration changes). An offer's note stays on the offer and is **not** copied to the invoice created on acceptance. Voiding an invoice never copies the invoice's note to the credit note; only the note entered in the void dialog is printed there.

Manual invoice drafts: an update without `note` keeps the stored note; `null` or a blank value removes it. Offer drafts are saved as a whole, so a missing note clears it.

## Freezing

The note is stored on the document (`billing_invoices.note`, `billing_offers.note`, `billing_invoice_void_documents.note`). Invoices and offers can only change it while they are drafts; once issued or archived the note is part of the document, and regenerated PDFs show the stored note. The credit note keeps the note it was issued with.

## Validation

- Optional; at most **2000** characters (`note must be at most 2000 characters`), strings only.
- Line breaks are kept (CR/LF normalized to LF), surrounding whitespace is trimmed per line, runs of blank lines collapse to one, and control characters, lone surrogates and U+FFFE / U+FFFF are stripped (they are invalid in XML 1.0). A blank note is stored as `null`.
- The PDF template HTML-escapes the note; the XML builder escapes markup characters.

## Output

| Output                            | Representation                                                                                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Invoice / credit note / offer PDF | "Notes" section below the totals, line breaks preserved                                                                                                             |
| E-invoice XML (CII, EN 16931)     | Invoice note BG-1: `rsm:ExchangedDocument/ram:IncludedNote/ram:Content` (BT-22) without `ram:SubjectCode` (BT-21 is optional), before the `AAR` delivery-terms note |

EN 16931 allows any number of invoice notes, so the document note and the delivery-terms note (see [Payment and delivery terms](./document-terms.md)) coexist. The XML stays valid for the EN 16931 / Factur-X EN 16931 profile; validate with Mustang (`--action validate`).

Line-level notes (BT-127) are not supported.

## API responses

`note` (string or `null`) is returned on invoice details (customer and admin), admin offer details and customer offer details. The billing console shows it in the invoice and offer detail views.
