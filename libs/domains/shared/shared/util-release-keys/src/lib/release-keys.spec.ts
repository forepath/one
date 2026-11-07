import { releaseKeyId } from '@forepath/shared/shared/util-release-signing';

import {
  isReleaseProduct,
  RELEASE_PRODUCTS,
  RELEASE_SIGNING_KEY_SECRETS,
  RELEASE_SIGNING_KEYS,
  RELEASE_SIGNING_KEYS_SOURCE,
} from './release-keys';

describe('release keys', () => {
  it('has one key set and one secret per product', () => {
    expect(Object.keys(RELEASE_SIGNING_KEYS)).toEqual([...RELEASE_PRODUCTS]);
    expect(Object.keys(RELEASE_SIGNING_KEY_SECRETS)).toEqual([...RELEASE_PRODUCTS]);

    for (const product of RELEASE_PRODUCTS)
      expect(RELEASE_SIGNING_KEY_SECRETS[product]).toBe(`${product.toUpperCase()}_RELEASE_SIGNING_KEY`);

    expect(isReleaseProduct('loadweaver')).toBe(true);
    expect(isReleaseProduct('other')).toBe(false);
    expect(RELEASE_SIGNING_KEYS_SOURCE).toMatch(/util-release-keys\/src\/lib\/release-keys\.ts$/);
  });

  it('compiles in valid, distinct P-256 public keys only', () => {
    for (const product of RELEASE_PRODUCTS) {
      const ids = RELEASE_SIGNING_KEYS[product].map((pem) => releaseKeyId(pem));

      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
