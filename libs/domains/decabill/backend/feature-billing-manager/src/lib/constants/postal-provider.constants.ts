/** Where the recipient address sits on the first page: `left` (DIN 5008, EU) or `right` (Swiss window envelopes). */
export const POSTAL_ADDRESS_POSITIONS = ['left', 'right'] as const;

export type PostalAddressPosition = (typeof POSTAL_ADDRESS_POSITIONS)[number];

/** Pingen environments: `staging` is Pingen's sandbox (letters are never printed or posted). */
export const PINGEN_ENVIRONMENTS = ['production', 'staging'] as const;

/** Pingen virtual delivery products (Pingen picks the matching product for the destination country). */
export const PINGEN_DELIVERY_PRODUCTS = ['fast', 'cheap', 'bulk', 'premium', 'registered'] as const;

export const PINGEN_PRINT_MODES = ['simplex', 'duplex'] as const;

export const PINGEN_PRINT_SPECTRUMS = ['color', 'grayscale'] as const;
