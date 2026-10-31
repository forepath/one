/**
 * Signed product release manifests (see `tools/release-integrity/README.md`, "Signed release manifests"):
 *
 *   create        --product <p> --release <v> --commit <sha> [--repository owner/repo] [--channel stable|beta]
 *                 [--images-from-projects] [--image name=repo[:tag]@sha256:…]… [--files <prefix>=<dir>]… --out <dir>
 *                 [--sign]   (private key from the product's environment variable, e.g. AGENSTRA_RELEASE_SIGNING_KEY)
 *   sign          --product <p> --manifest <file>   (signs a manifest `create` wrote; CI runs this in its own step,
 *                 the only one with the key)
 *   verify        --product <p> --manifest <file> [--signature <file>] [--files <dir>] [--trust-key <pem file>]…
 *   generate-key  --product <p> --private-key-out <file>
 *
 * Run through Nx: `npx nx run release-integrity:release-manifest -- <command> …` and
 * `npx nx run release-integrity:generate-release-key -- --product <p> --private-key-out <file>`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import {
  isReleaseProduct,
  RELEASE_SIGNING_KEY_SECRETS,
  RELEASE_SIGNING_KEYS,
  RELEASE_SIGNING_KEYS_SOURCE,
  type ReleaseProduct,
} from '@forepath/shared/shared/util-release-keys';
import {
  checkReleaseFiles,
  createProductReleaseManifest,
  generateReleaseKeyPair,
  productReleaseManifestBytes,
  signManifest,
  verifyProductReleaseManifest,
  type ReleaseFile,
  type ReleaseImage,
} from '@forepath/shared/shared/util-release-signing';

import {
  assertTrustedSigningKey,
  collectReleaseFiles,
  discoverReleaseImages,
  parseImageArgument,
  pinReleaseImages,
  readPemFiles,
} from './release-manifest';

function fail(message: string): never {
  console.error(`release-manifest: ${message}`);
  process.exit(1);
}

function productOf(value: string | undefined): ReleaseProduct {
  if (!value || !isReleaseProduct(value)) fail(`--product must be one of ${Object.keys(RELEASE_SIGNING_KEYS)}`);

  return value;
}

export function manifestFileName(product: string, version: string): string {
  return `${product}-release-manifest-${version}.json`;
}

async function create(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      product: { type: 'string' },
      release: { type: 'string' },
      commit: { type: 'string' },
      repository: { type: 'string', default: 'forepath/one' },
      channel: { type: 'string' },
      'images-from-projects': { type: 'boolean', default: false },
      image: { type: 'string', multiple: true, default: [] },
      files: { type: 'string', multiple: true, default: [] },
      out: { type: 'string' },
      sign: { type: 'boolean', default: false },
    },
  });
  const product = productOf(values.product);
  const version = (values.release ?? '').replace(/^v/, '');

  if (!values.out || !values.commit) fail('--commit and --out are required');

  if (values.channel !== undefined && values.channel !== 'stable' && values.channel !== 'beta')
    fail('--channel must be stable or beta');

  const images: ReleaseImage[] = values.image.map(parseImageArgument);

  if (values['images-from-projects']) images.push(...pinReleaseImages(discoverReleaseImages('apps', product), version));

  const files: ReleaseFile[] = [];

  for (const spec of values.files) {
    const at = spec.indexOf('=');

    if (at <= 0) fail(`--files expects <prefix>=<dir>, got ${spec}`);

    files.push(...(await collectReleaseFiles(spec.slice(0, at), spec.slice(at + 1))));
  }

  const manifest = createProductReleaseManifest({
    product,
    version,
    ...(values.channel ? { channel: values.channel as 'stable' | 'beta' } : {}),
    source: { repository: values.repository, commit: values.commit },
    images,
    files,
  });
  const bytes = productReleaseManifestBytes(manifest);
  const target = join(values.out, manifestFileName(product, version));

  mkdirSync(values.out, { recursive: true });
  writeFileSync(target, bytes);
  console.log(`${target}: ${manifest.images.length} images, ${manifest.files.length} files`);

  if (!values.sign) return;

  signFile(product, target, bytes);
}

/** Signs manifest bytes with the product's key (environment) and writes `<target>.sig`. */
function signFile(product: ReleaseProduct, target: string, bytes: Buffer): void {
  const secret = RELEASE_SIGNING_KEY_SECRETS[product];
  const privateKeyPem = process.env[secret];

  if (!privateKeyPem) fail(`signing needs the private key in ${secret}`);

  // The key is used here only; neither it nor anything derived from its private half is printed.
  const signature = signManifest(bytes, privateKeyPem);

  assertTrustedSigningKey(signature.keyId, RELEASE_SIGNING_KEYS[product], product);

  const check = verifyProductReleaseManifest(bytes, signature, RELEASE_SIGNING_KEYS[product], product);

  if ('reason' in check) fail(`the new signature does not verify: ${check.reason}`);

  writeFileSync(`${target}.sig`, `${JSON.stringify(signature)}\n`);
  console.log(`${target}.sig: signed with key ${signature.keyId}`);
}

/**
 * `sign`: signs a manifest `create` wrote earlier (M6 review L5: the release workflow builds without the key and
 * signs in a separate step that only runs this).
 */
function sign(argv: string[]): void {
  const { values } = parseArgs({
    args: argv,
    options: { product: { type: 'string' }, manifest: { type: 'string' } },
  });
  const product = productOf(values.product);

  if (!values.manifest || !existsSync(values.manifest)) fail('--manifest <file> is required');

  signFile(product, values.manifest, readFileSync(values.manifest));
}

async function verify(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      product: { type: 'string' },
      manifest: { type: 'string' },
      signature: { type: 'string' },
      files: { type: 'string' },
      'trust-key': { type: 'string', multiple: true, default: [] },
    },
  });
  const product = productOf(values.product);

  if (!values.manifest) fail('--manifest is required');

  const signaturePath = values.signature ?? `${values.manifest}.sig`;
  let signature: unknown;

  try {
    signature = JSON.parse(readFileSync(signaturePath, 'utf8'));
  } catch {
    fail(`${signaturePath} is missing or not JSON`);
  }

  const trusted = [...RELEASE_SIGNING_KEYS[product], ...readPemFiles(values['trust-key'])];
  const check = verifyProductReleaseManifest(readFileSync(values.manifest), signature, trusted, product);

  if ('reason' in check) fail(`NOT VERIFIED: ${check.reason}`);

  const { manifest } = check;

  console.log(
    `verified: ${manifest.product} ${manifest.version} (${manifest.channel}), ${manifest.source.repository}@${manifest.source.commit}, key ${check.keyId}`,
  );

  for (const image of manifest.images) console.log(`  image ${image.name}  ${image.repository}@${image.digest}`);

  if (!values.files) return;

  const results = await checkReleaseFiles(manifest.files, values.files);
  const present = results.filter((r) => r.status !== 'missing');

  for (const r of present) console.log(`  file ${r.status === 'ok' ? 'OK      ' : 'MISMATCH'} ${r.path}`);

  if (present.length === 0) fail(`none of the manifest's files is present below ${values.files}`);

  if (present.some((r) => r.status === 'mismatch')) fail('files do not match the signed manifest');
}

function generateKey(argv: string[]): void {
  const { values } = parseArgs({
    args: argv,
    options: { product: { type: 'string' }, 'private-key-out': { type: 'string' } },
  });
  const product = productOf(values.product);
  const target = values['private-key-out'];

  if (!target) fail('--private-key-out <file> is required (the private key is never printed)');

  if (existsSync(target)) fail(`${target} exists; refusing to overwrite a key`);

  const pair = generateReleaseKeyPair();

  writeFileSync(target, pair.privateKeyPem, { mode: 0o600, flag: 'wx' });
  console.log(`key id ${pair.keyId}\n\n${pair.publicKeyPem}`);
  console.log(
    `add the public key to RELEASE_SIGNING_KEYS.${product} in ${RELEASE_SIGNING_KEYS_SOURCE};\n` +
      `private key written to ${target} (0600): store it as the CI secret ${RELEASE_SIGNING_KEY_SECRETS[product]}, then delete the file`,
  );
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2).filter((a) => a !== '--');

  if (command === 'create') return await create(rest);

  if (command === 'verify') return await verify(rest);

  if (command === 'sign') return sign(rest);

  if (command === 'generate-key') return generateKey(rest);

  fail('usage: create | sign | verify | generate-key (see tools/release-integrity/README.md)');
}

if (require.main === module) {
  main().catch((error: Error) => fail(error.message));
}
