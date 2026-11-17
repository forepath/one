# shared-shared-util-barcode

Dependency-free barcode and serial number helpers shared by backends and frontends:

- GTIN (EAN-8, UPC-A, EAN-13, GTIN-14) normalization and GS1 check-digit validation
- Module geometry for EAN-8, EAN-13, UPC-A (as EAN-13) and Code 128 (subset B, subset C for even-length digit strings)
- `renderBarcodeSvg` for server-rendered documents; frontends draw `BarcodeGeometry.bars` in a template (no `innerHTML`)
- Serial number input: single serial numbers and ranges (`SN-0001..SN-0050`, last digit group counts up, padding of the
  first end kept) separated by line breaks, commas or semicolons (`parseSerialNumberInput`), and the inverse compact
  notation for display (`compressSerialNumbers`)

Run tests with `npx nx test shared-shared-util-barcode`.
