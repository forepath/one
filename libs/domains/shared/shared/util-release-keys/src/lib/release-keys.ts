/**
 * The public keys every ForePath product's releases are signed with — one key set per product, the single source of
 * truth for the release tooling (`tools/release-integrity/signing`: sign, verify) and for products that verify
 * releases themselves (Loadweaver's control plane, node agent and CLI verify release bundles with
 * `RELEASE_SIGNING_KEYS.loadweaver`).
 *
 * The private keys exist only as CI secrets held by the product owner, never in the repository:
 *
 *   npx nx run release-integrity:generate-release-key -- --product <product> --private-key-out <secure path>
 *
 * prints the key id and the public key: add the public PEM to the product's list below, store the private PEM as the
 * secret named in `RELEASE_SIGNING_KEY_SECRETS`, then delete the file. Keep the previous key during a rotation until
 * no supported release is signed with it anymore. Empty lists: the product has no key yet (releases stay unsigned).
 */
export const RELEASE_PRODUCTS = ['agenstra', 'decabill', 'forepath', 'loadweaver'] as const;
export type ReleaseProduct = (typeof RELEASE_PRODUCTS)[number];

export const RELEASE_SIGNING_KEYS: Readonly<Record<ReleaseProduct, readonly string[]>> = {
  agenstra: [
    `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEznOMiq1ujQN11LcgmZLjuNvJsEEx
fiH5kXrmSsTrtg0m7uN86v3F+dsezMPnhwVbDye9YLwadN5x6JSKWSP7Qw==
-----END PUBLIC KEY-----`,
  ],
  decabill: [
    `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEUohH6EOYJcAEVxzYWdYpYTFKmHv9
LAM9hnK1GtgL2XnbEam6dyPMvVKtWwLKzVmdWm4Kx5wwsSfYw2Nz28on2A==
-----END PUBLIC KEY-----`,
  ],
  forepath: [
    `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEWAQHPSTl/3dtzBbgThhEP7JBonr2
SpOgPcrywXhQuj2V8I792FdpTwpeBSHpC9Jl0K0LyAgjritdYN/9X2FHAg==
-----END PUBLIC KEY-----`,
  ],
  /** Signs the release bundle (3.26) and the release manifest. */
  loadweaver: [
    `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE+0A8l1J1ej8arK1T2rFGPJ/PjI+e
xsyoe3fpfUlWiH8xkdXzFmtH/jVjSLYpVS1FnogBQIT+ER0AvNezn33nYg==
-----END PUBLIC KEY-----`,
  ],
};

/** The CI secret (environment `production`) holding each product's private key; also the variable `--sign` reads. */
export const RELEASE_SIGNING_KEY_SECRETS: Readonly<Record<ReleaseProduct, string>> = {
  agenstra: 'AGENSTRA_RELEASE_SIGNING_KEY',
  decabill: 'DECABILL_RELEASE_SIGNING_KEY',
  forepath: 'FOREPATH_RELEASE_SIGNING_KEY',
  loadweaver: 'LOADWEAVER_RELEASE_SIGNING_KEY',
};

/** Where the public keys are declared (for messages of the key tooling). */
export const RELEASE_SIGNING_KEYS_SOURCE = 'libs/domains/shared/shared/util-release-keys/src/lib/release-keys.ts';

export function isReleaseProduct(value: string): value is ReleaseProduct {
  return (RELEASE_PRODUCTS as readonly string[]).includes(value);
}
