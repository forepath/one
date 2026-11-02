# loadweaver-shared-util-secrets

This library was generated with [Nx](https://nx.dev).

## Building

Run `nx build loadweaver-shared-util-secrets` to build the library.

## Running unit tests

Run `nx test loadweaver-shared-util-secrets` to execute the unit tests via [Jest](https://jestjs.io).

## age and SOPS (3.29)

Decryption of SOPS-encrypted YAML from Git with the cluster's age identity, built on `node:crypto` and `yaml` only (no `age` / `sops` binaries at runtime).

**age** (`src/lib/age.ts`, [age v1](https://age-encryption.org/v1), X25519 recipients only):

- `generateAgeIdentity()` returns `{ identity: 'AGE-SECRET-KEY-1…', recipient: 'age1…' }`. Related helpers: `ageRecipientOf(identity)`, `ageIdentityFromRaw(raw)`, `isAgeIdentity`, `isAgeRecipient`, `parseAgeIdentities(keyFileText)`.
- `ageDecrypt(file, identities)` accepts binary or ASCII-armored files (`Buffer` or string). Stanza types other than `X25519` (scrypt, ssh-\*, plugins, post-quantum, grease) are skipped. The header MAC, STREAM chunks, truncation, trailing data and low-order shares are all checked.
- `ageEncrypt(plaintext, recipients, { armor? })`, plus `ageArmor` / `ageDearmor` and `bech32Encode` / `bech32Decode` (BIP-173).

**SOPS** (`src/lib/sops.ts`, SOPS 3.x YAML, age recipients only):

- `sopsDecrypt(text, identities)` returns `{ yaml, documents }`. Use `sopsDecryptYaml` for the YAML string or `sopsDecryptYamlDocuments` for the parsed documents.
- The `sops` block is removed. Formatting and comments are kept, and encrypted comments (`#ENC[…]`, including the list-item form) are decrypted.
- The MAC is verified exactly as SOPS does it. It covers all values, or only encrypted ones with `mac_only_encrypted`. Unencrypted values are resolved the go-yaml way.
- `unencrypted_suffix`, `encrypted_suffix`, `unencrypted_regex` and `encrypted_regex` are supported.
- Multi-document files work.
- Errors (`sops: …`) name paths, never plaintext.
- `isSopsDocument(text)` checks whether a text is a SOPS file. `readSopsMetadata(text)` reads the metadata.
- Not supported:
  - KMS / PGP / Vault-only files, and Shamir key groups (`key_groups`, `shamir_threshold`).
  - `unencrypted_comment_regex` / `encrypted_comment_regex`.
  - YAML aliases and non-string keys.
  - Hand-edited unencrypted values in non-canonical go-yaml forms, for example `2024-01-02` instead of the RFC 3339 timestamp SOPS writes. SOPS normalizes these when it encrypts.

Unit tests include known-answer fixtures made by the real `age` 1.3.2 / `sops` 3.13.3 (`src/lib/__fixtures__`, with a throwaway test identity).

## Lab tests (age / SOPS interoperability)

Run `nx run loadweaver-shared-util-secrets:integration-test` (needs Docker). It builds `src/integration/sops-lab.Dockerfile`, which contains:

- the official `ghcr.io/getsops/sops:v3.13.3-alpine`, pinned by digest;
- the official `age` v1.3.2 release, pinned by sha256.

The tests then check:

- files made by `age` / `sops` decrypt here;
- files made here decrypt with `age`;
- tampering and wrong identities fail.

Data goes through stdin / stdout (no bind mounts).
