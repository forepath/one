# E-invoice formats

Every issued invoice is a hybrid **Factur-X / ZUGFeRD** PDF (PDF/A-3 with embedded CII XML). In addition, Decabill can produce the structured invoice in other internationally accepted EN 16931 formats. The format is chosen per invoice from the **customer's override** or the **issuer default** and stored on the invoice when it is issued.

| Format id           | Standard                                     | Syntax  | Embedded in the PDF     | Notes                                            |
| ------------------- | -------------------------------------------- | ------- | ----------------------- | ------------------------------------------------ |
| `factur-x-en16931`  | Factur-X 1.0 / ZUGFeRD 2.x, profile EN 16931 | CII     | yes (EN 16931)          | Default                                          |
| `factur-x-basic`    | Factur-X / ZUGFeRD BASIC                     | CII     | yes (BASIC)             |                                                  |
| `factur-x-extended` | Factur-X / ZUGFeRD EXTENDED                  | CII     | yes (EXTENDED)          |                                                  |
| `xrechnung-cii`     | XRechnung 3.0 (German CIUS)                  | CII     | yes (XRECHNUNG profile) | Needs a buyer reference (BT-10, e.g. Leitweg-ID) |
| `xrechnung-ubl`     | XRechnung 3.0                                | UBL 2.1 | EN 16931 CII            | Needs a buyer reference                          |
| `peppol-bis-3`      | Peppol BIS Billing 3.0                       | UBL 2.1 | EN 16931 CII            | Needs electronic addresses (EndpointID)          |
| `ubl-en16931`       | EN 16931                                     | UBL 2.1 | EN 16931 CII            |                                                  |

- **Issuer default**: `BILLING_EINVOICE_FORMAT`; when unset, Peppol BIS for issuers in BE, NL, LU, NO, SE, DK, FI, IE, otherwise Factur-X EN 16931.
- **Customer override** (admin customer profile): `einvoiceFormat`, `buyerReference` (BT-10, Leitweg-ID for German public buyers) and `einvoiceEndpoint` as `scheme:id` with a Peppol EAS code (e.g. `0088:4012345000009`, `0204:991-12345-67`). Without an explicit endpoint the VAT id is used with the country's EAS scheme, then the e-mail address (`EM`, XRechnung only). Customers can maintain their buyer reference and endpoint themselves.
- **Download**: customers `GET /invoices/ref/:invoiceRefId/einvoice`, admins `GET /admin/billing/invoices/:id/einvoice` — the XML in the invoice's format, built from the frozen invoice data. Credit notes use the UBL `CreditNote` document.
- Every format carries the invoice's VAT breakdown per rate, the ISO 11649 **payment reference** (CII BT-83 `PaymentReference`, UBL `PaymentID`) and the SEPA payee account.
- Decabill creates the files; it does not transmit them over the Peppol network or national platforms (SDI, KSeF, Chorus Pro / PA).

## Related documentation

- [Invoices](./invoices.md)
- [Customer profiles](./customer-profiles.md)
- [Accounting](./accounting.md)
