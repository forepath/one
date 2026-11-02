/**
 * Release signatures (3.26): ECDSA P-256 with SHA-256 over the manifest's canonical JSON bytes, DER-encoded and
 * base64'd — the same primitive the cosign verifier in the control plane uses (`image-signature.ts`). The private key
 * exists only as a CI secret; the public keys are compiled into the control plane, the node agent and the CLI
 * (`RELEASE_SIGNING_KEYS.loadweaver` of `@forepath/shared/shared/util-release-keys`, see `bundle-trust.ts`).
 * Implemented once for every ForePath product in `@forepath/shared/shared/util-release-signing`.
 */
export {
  RELEASE_SIGNATURE_ALGORITHM,
  releaseSignatureSchema,
  releaseKeyId,
  signManifest,
  verifyManifestSignature,
  generateReleaseKeyPair,
  type ReleaseSignature,
  type SignatureCheck,
} from '@forepath/shared/shared/util-release-signing';
