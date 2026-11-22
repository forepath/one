# Document branding

Generated PDFs carry an optional **logo** and a **brand color**. Applies to invoices, credit notes (void and partial), offers, project time reports and inventory movement documents. Supplier invoice copies are documents of the supplier and never show the own logo; they use a neutral accent. Inventory labels are unchanged.

## Settings

| Setting                        | Value                                                                                   | Without a value            |
| ------------------------------ | --------------------------------------------------------------------------------------- | -------------------------- |
| `BILLING_DOCUMENT_LOGO`        | Base64 `data:` URI of a PNG, JPEG, WebP or SVG image, at most 65536 characters (~48 KB) | No logo                    |
| `BILLING_DOCUMENT_BRAND_COLOR` | Hex color `#rrggbb` (`#rgb` is expanded)                                                | `#32a852` (Decabill green) |

Both are set in the billing console under **Administration → Settings → Documents** and resolve like every tenant setting: **tenant** override → override for **all tenants** → environment variable → default. The logo row offers a file picker with preview; **Remove image** saves an empty value, so a tenant (or the all-tenants level) can switch off a logo it would otherwise inherit. Resetting removes the override and the next layer applies again.

## Layout

- The logo sits top right in the document header (56 px high, at most 200 px wide, aspect ratio kept). Wide logos with little height work best.
- The brand color is used for the document type in the header (e.g. "Invoice") only. All other text, borders and rules stay neutral; prefer a color dark enough to read on white.
- Content blocks (document data, addresses, tables, totals, notes, terms, payment details) are framed by 1 px boxes with equal padding; text inside boxes lines up with table cells.

## Validation and security

- Only `data:` URIs are accepted, never remote URLs: PDFs are rendered server-side, and a URL would let the renderer fetch arbitrary (internal) addresses.
- The decoded bytes must match the declared type (PNG / JPEG / WebP signature, SVG root element). SVG with a `DOCTYPE` or entity declarations is rejected. Images are embedded via `<img>`, where browsers run no scripts and load no external resources.
- Environment values are validated the same way when documents are rendered; an invalid value is logged and ignored (no logo / default color).

## Existing documents

Branding applies when a PDF is generated. Already stored PDFs (issued invoices, archived offers, signed documents) are not re-rendered.
