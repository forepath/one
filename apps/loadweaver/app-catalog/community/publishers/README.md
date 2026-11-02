# Publishers

One file per publisher: `publishers/<publisher-slug>.yaml`.

```yaml
name: My Name # exactly the manifest's `publisher`
label: community # community; verified only by the maintainers (after an identity check)
contact: https://github.com/my-name # how maintainers reach you (URL or email)
homepage: https://example.com # optional
keys: # one or more public keys (several = rotation); inline PEM or a path in this catalog
  - |
    -----BEGIN PUBLIC KEY-----
    ...
    -----END PUBLIC KEY-----
```

- Keys are ECDSA P-256 or Ed25519 public keys in PEM (`loadweaver app keygen`, `openssl`, or cosign's `cosign.pub`).
- The key id is the SHA-256 of the key's DER (SPKI); `loadweaver app sign` prints it.
- To rotate, add the new key, sign new versions with it, and remove the old key once no listed version needs it.
- A lost or leaked key: open an issue immediately; the maintainers remove the key and take down what it signed.
- Never put a private key here; CI refuses any `PRIVATE KEY` in the catalog.

`example-publisher.yaml` holds a **development** key that signs the example app only.
