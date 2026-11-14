import type { SharedHeroMascotBrand } from '@forepath/shared/frontend/feature-landingpage';

/** The products with brand artwork (the character, the mark stack); any other shows none. */
const AUTH_BRANDS: Record<string, SharedHeroMascotBrand> = {
  agenstra: 'agenstra',
  decabill: 'decabill',
  forepath: 'forepath',
};

/** The brand whose artwork the auth pages of `productName` show, or null for a product without one. */
export function resolveAuthBrand(productName: string): SharedHeroMascotBrand | null {
  return AUTH_BRANDS[productName.toLowerCase()] ?? null;
}
