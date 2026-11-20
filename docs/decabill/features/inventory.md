# Inventory

Admin-only stock keeping: warehouses with storage compartments, articles with barcodes and optional serial numbers, lendings to customers and staff, printable labels, numbered and signed movement documents, and withdrawal requests raised by offers, invoices and subscriptions.

## Data model

| Concept            | Table                                   | Notes                                                                                                       |
| ------------------ | --------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Warehouse          | `billing_inventory_warehouses`          | Tenant-scoped, unique `code` per tenant, optional address, active flag                                      |
| Compartment        | `billing_inventory_compartments`        | Storage location in a warehouse, unique `code` per warehouse (for example `A-01-03`), active flag           |
| Article            | `billing_inventory_articles`            | Master data (see below); `ART-{nnnnnn}` article number                                                      |
| Placement (stock)  | `billing_inventory_stock`               | Article in a compartment with its on-hand `quantity` (≥ 0, three decimals); quantity 0 = mapped location    |
| Movement document  | `billing_inventory_movements`           | Putaway / transfer / withdrawal / lending / return with a document number, snapshot and archived PDF        |
| Serial unit        | `billing_inventory_serial_units`        | One unit of a serial-tracked article: serial number (unique per article), `in_stock` / `lent` / `withdrawn` |
| Lending            | `billing_inventory_lendings`            | Stock on loan to a borrower, quantity returned so far, optional due date, `open` / `returned`               |
| Withdrawal request | `billing_inventory_withdrawal_requests` | Raised outside the inventory pages; stock moves only after an admin accepts it                              |

An article can be placed in any number of compartments (also across warehouses), each with its own quantity, or in none.

### Article fields

| Field                                         | Notes                                                                                        |
| --------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `articleNumber`                               | `ART-{nnnnnn}`, allocated like customer numbers; the internal identifier, shown as Code 128  |
| `name`, `description`                         |                                                                                              |
| `ean`                                         | GTIN-8, UPC-A, EAN-13 or GTIN-14 with valid check digit, unique per tenant; shown as barcode |
| `unit`                                        | `piece`, `pack`, `box`, `pallet`, `set`, `kg`, `g`, `l`, `ml`, `m`, `m2`, `m3`               |
| `purchasePriceNet`, `salesPriceNet`           | Optional; the sales price is prefilled on offer / invoice article positions                  |
| `currency`, `taxCategory`                     | `standard` or `reduced`; prefilled on positions                                              |
| `manufacturer`, `manufacturerPartNumber`      |                                                                                              |
| `supplierId`, `supplierArticleNumber`         | Supplier profile of the tenant                                                               |
| `reorderPoint`, `reorderQuantity`             | Total stock at or below the reorder point is _low stock_ (`article.low_stock` webhook)       |
| `weightKg`, `lengthCm`, `widthCm`, `heightCm` |                                                                                              |
| `hsCode`, `countryOfOrigin`                   | Customs tariff number and ISO country                                                        |
| `isActive`                                    | Inactive articles cannot be put away; stock can still leave                                  |
| `serialTracking`                              | Every unit carries a serial number (see below); switchable only without stock and loans      |

Articles with stock, movements or requests cannot be deleted (documents reference them); deactivate them instead. Warehouses and compartments can be deleted once they hold no stock; existing documents keep their location snapshot.

## Movements and documents

Every stock change is a movement with its own document:

| Type       | Number               | Locations     | Reasons                                                                               |
| ---------- | -------------------- | ------------- | ------------------------------------------------------------------------------------- |
| Putaway    | `PUT-{year}-{nnnnn}` | target        | `receipt`, `return`, `correction`, `other`                                            |
| Transfer   | `TRF-{year}-{nnnnn}` | source/target | —                                                                                     |
| Withdrawal | `WDR-{year}-{nnnnn}` | source        | `consumption`, `damage`, `loss`, `correction`, `other`; `fulfillment` (requests only) |
| Lending    | `LND-{year}-{nnnnn}` | source        | — (borrower and due date on the document)                                             |
| Return     | `RTN-{year}-{nnnnn}` | target        | — (returns stock of a lending)                                                        |

Numbers follow `TENANTS_SHARED_NUMBERS` (see [Numbering](./numbering.md)) and are allocated inside the movement transaction, so a failed booking releases its number. Bookings lock the affected placements (`SELECT … FOR UPDATE` in id order), never let a quantity drop below zero and reject inactive targets.

After commit the document PDF is rendered (same print style as time reports, with article and EAN barcodes, locations, remaining stock, signature lines) and archived under the File Explorer folder `inventory/documents/{putaways|transfers|withdrawals|lendings|lending-returns}/{year}/`. Documents of serial-tracked articles list the moved serial numbers (consecutive runs as ranges). Like invoices and offers, it is registered in `billing_stored_files`, signed with `BILLING_FILE_SIGNING_SECRET` and stamped with its Document ID. If rendering fails the movement still stands; downloading the document renders and archives it again.

## Serial numbers

Articles with `serialTracking` keep one unit row per serial number. Every movement of such an article names its units, and its quantity must equal their count (whole units only):

- Serial numbers are entered one per line (or separated by commas / semicolons), or as **ranges** `first..last`: the last digit group counts up and the zero padding of the first end is kept (`LAP-007..LAP-010` → `LAP-007`, `LAP-008`, `LAP-009`, `LAP-010`). Both ends must otherwise be identical. At most 1000 serial numbers per movement; duplicates and invalid entries are rejected with the offending entries named. Serial numbers use letters, digits and `. _ - / : + #` (up to 128 characters).
- A **putaway** registers new serial numbers in the target compartment. A serial number already in stock or on loan is refused; a withdrawn one comes back into stock (its history continues).
- **Transfers, withdrawals, lendings and accepted requests** move only units that are in stock in the source compartment. If any listed serial number does not match (unknown, elsewhere, on loan or withdrawn), nothing moves and the response names the mismatches.
- **Returns** accept only units on loan under that lending.

Units are locked together with the placements (`FOR UPDATE`), and a concurrent registration of the same serial number is rejected by a unique index. Switching `serialTracking` takes an exclusive article lock and is refused while the article has stock or open lendings; bookings take a share lock, so a switch never interleaves with a running booking.

Serial numbers are searchable everywhere: the article list finds the article of a scanned serial number, the article page lists its units (status, compartment or borrower) with their movement history, and documents and lendings match serial numbers too.

## Lendings

A lending hands stock out on loan without withdrawing it: the `LND-` document takes the stock (or the named units) out of its compartment, and the article reports it as `lentQuantity` (not part of the on-hand total). The borrower is

- a **user account**: customers become borrower kind `customer`, administrators `staff` (name, email and customer number are snapshotted), or
- an **employee without account** (`borrowerName`, kind `staff`).

An optional due date (today or later) flags open lendings past it as _overdue_. Returns (`RTN-`) book stock back into any active compartment, fully or in parts; serial-tracked lendings name the returned units. A lending closes once everything is back. Returns lock the lending row, so concurrent returns cannot exceed the lent quantity.

## Labels

Labels are exported synchronously as one PDF (at most 1000 labels per print); every label is framed:

| Label            | Content                                                                                                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Article number   | Article name and the article number as Code 128 (selected units also show their serial number)                                                                               |
| EAN              | Article name and the EAN barcode (articles without an EAN are skipped)                                                                                                       |
| Property sticker | "Property of" the issuer (`BILLING_ISSUER_NAME`, address, `BILLING_ISSUER_EMAIL` as contact), the article and a Code 128 of the unit's serial number (or the article number) |

Property stickers of a serial-tracked article are printed once per unit in stock or on loan. Layouts: A4 sheets with 24 labels to cut out (3 × 8, 5 mm page margins, 3 mm between labels, about 64.7 × 33.3 mm each) or one 70 × 37 mm label per page for label printers. Print from the article page, in bulk from the article list (select articles), or for selected serial numbers on the article page.

## Withdrawal requests

Requests are created by actions outside the inventory and never move stock by themselves:

| Source       | Raised when                                                                      | Key (idempotent)                                                |
| ------------ | -------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Offer        | An offer with `article` lines is accepted (lines are billed like standard lines) | `offer-line:{lineId}`                                           |
| Invoice      | An invoice with article positions (`inventoryArticleId`) is issued               | `invoice-line:{lineId}`                                         |
| Subscription | A subscription period invoice is issued and the plan lists per-period articles   | `subscription-invoice:{invoiceId}:{subscriptionId}:{articleId}` |

Admins decide on **Inventory → Requests**: _Accept_ picks the source compartments (suggestions: compartments holding the article, most stock first, plus search) whose quantities must add up to the request (serial-tracked articles name the units per compartment); each compartment becomes one withdrawal document with reason `fulfillment`, all in one transaction. _Reject_ records a reason and moves nothing. A request can be decided only once (row lock).

Article positions are available in the offer editor (line type _Article_), the manual invoice editor and the project bill-time extra lines (position type _Article_), and as _Articles per billing period_ on service plans. Picking an article prefills the unit price from its net sales price (only when one is set), an empty description with the article name, and the VAT category.

## Console

- **Inventory → Warehouses**: column browser _Warehouses → Compartments → Contents → Article in compartment_ (same layout as Agenstra's workspace / environment rails). Every column is server-paged (replace-page) and searchable; the selection is kept in the URL (`?warehouse=&compartment=&placement=`). An empty compartment offers _Add article_: map it (quantity 0), put new goods away, or take them from another compartment (transfer with suggestions).
- **Inventory → Articles**: paged list (low-stock filter) and article detail with barcodes, master data, locations (putaway / transfer / withdraw / remove, add location with quantity 0, new goods or transfer) and movement documents. New articles can be mapped to locations with quantities right away.
- **Inventory → Requests**: pending / accepted / rejected requests with accept and reject dialogs.
- **Inventory → Lendings**: open (by due date), overdue or returned lendings with return dialog and document download; the tab shows the overdue count.
- **Inventory → Documents**: all movement documents with type filter and PDF download.

Move dialogs choose the target by typeahead over all active compartments, or from a paged list of other compartments (in any warehouse) that already hold the article. The movement _Reference_ is picked from a typeahead over invoices, offers, supplier invoices, subscriptions, projects and customers (their admin list searches, queried in parallel; the document number, project name or customer number is stored), or entered as _Other_ free text such as a delivery note number.

## Live updates

The `socket/inventory` namespace (`INVENTORY_WEBSOCKET_NAMESPACE`) pushes the current state of changed warehouses, compartments, articles, placements, movements, requests and lendings (`lendingUpsert`; `serialUnitsChanged` names articles whose units moved) to subscribed administrators of the tenant; open pages patch rows in place and reload the current page when rows are added or move. Requests raised by worker processes (subscription billing) are announced with `requestsChanged`, polled every `INVENTORY_REQUESTS_POLL_INTERVAL` ms (default `15000`, 5–120 s) while admins are subscribed. See the [AsyncAPI](/spec/billing-manager/asyncapi.yaml).

## API

Base path `/admin/billing/inventory`, `ADMIN` role and PAT scope `inventory:admin` (sockets: `websocket:inventory:read`):

- `GET summary`
- `GET|POST warehouses`, `GET|POST|DELETE warehouses/{id}`, `POST warehouses/{id}/compartments`
- `GET compartments` (`warehouseId`, `activeOnly`), `GET|POST|DELETE compartments/{id}`, `GET compartments/{id}/stock`
- `GET|POST articles` (`activeOnly`, `lowStockOnly`), `GET|POST|DELETE articles/{id}`, `GET articles/{id}/stock` (`withStockOnly`)
- `POST stock` (map with quantity 0), `GET|DELETE stock/{id}`
- `GET movements` (`type`, `articleId`, `compartmentId`, `warehouseId`, `requestId`, `lendingId`, `serialNumber`), `GET movements/{id}`, `GET movements/{id}/pdf`
- `POST movements/putaway`, `POST movements/transfer`, `POST movements/withdrawal` (`serialNumbers`: singles and ranges)
- `GET serial-units` (`articleId`, `status`, `compartmentId`, `lendingId`)
- `GET|POST lendings` (`status`, `overdue`, `articleId`, `borrowerUserId`), `GET lendings/{id}`, `POST lendings/{id}/return`
- `POST labels` (`kinds`, `articleIds`, `serialUnitIds`, `copies`, `layout`) → PDF, `GET labels/owner` (company on property stickers)
- `GET withdrawal-requests` (`status`, `articleId`), `GET withdrawal-requests/{id}`, `POST withdrawal-requests/{id}/accept`, `POST withdrawal-requests/{id}/reject`

All lists take `limit` (max 100), `offset` and `search` and return `{ items, total }`.

## Webhooks and audit

Webhooks: `article.created`, `article.updated`, `article.deleted`, `article.low_stock`, `inventory_movement.created`, `withdrawal_request.created`, `withdrawal_request.accepted`, `withdrawal_request.rejected` (request events are routed to the customer as client), `inventory_lending.created`, `inventory_lending.returned`. Audit log processes: `inventory.warehouse.*`, `inventory.compartment.*`, `inventory.article.*`, `inventory.placement.*`, `inventory.movement.{putaway|transfer|withdrawal|lending|lending_return}`, `inventory.request.{created|accepted|rejected}`, `inventory.lending.{created|returned}`.

## Related documentation

- [Numbering](./numbering.md)
- [File Explorer](./file-explorer.md)
- [Offers](./offers.md)
- [Invoices](./invoices.md)
- [Service types and plans](./service-types-and-plans.md)
- [Webhooks](./webhooks.md)
