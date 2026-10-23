/**
 * Builds a Loadweaver release bundle (3.26): manifest + signature + artifacts in one tar.
 *
 *   npx nx run loadweaver-shared-util-release:build-bundle -- --release 3.5.0 \
 *     --control-plane-image ghcr.io/forepath/loadweaver-control-plane-api:3.5.0@sha256:… \
 *     --agent-amd64 dist/…/loadweaver-agent --agent-arm64 dist/…/loadweaver-agent-arm64 \
 *     [--opensearch-image ref@sha256:…] [--console-image ref@sha256:…] [--image-archive envoy=envoy.oci.tar …] [--gvisor] [--drbd-source] \
 *     [--drbd-prebuilt <kernel>:<arch>=<modules.tar.gz> …] [--drbd-compat <kernel>:<arch>=<entry.tar.gz> …] \
 *     [--apt-snapshot index.json [--apt-files <dir>]] [--note …] \
 *     [--minimum-version 3.4.0] [--out dist/loadweaver-bundle] [--require-signature] [--defer-signature]
 *
 * Signs with the PEM in `LOADWEAVER_RELEASE_SIGNING_KEY` (CI secret; never printed). Without it the bundle is unsigned
 * — accepted only by clusters with `LOADWEAVER_ALLOW_UNSIGNED_BUNDLES=true` (development, VM labs) — unless
 * `--require-signature` makes that an error (release builds).
 *
 * `--console-image` pins the release's console image (`loadweaver-console-server`) by digest in the signed manifest
 * (`consoleImage`): Loadweaver Cloud (Decabill) pulls the management endpoint's console by that digest. Release builds
 * pass it; without it the manifest has no console image and Loadweaver Cloud refuses to provision that release unless
 * the plan pins a console digest itself.
 *
 * `--drbd-compat` takes the DRBD compat-patch entries `scripts/drbd-compat.sh` generated per kernel of the release's
 * snapshot (air-gapped nodes build DRBD from source without LINBIT's SPAAS); each is validated (`drbd-compat.ts`).
 *
 * `--apt-snapshot` takes the bundle snapshot index `scripts/apt-snapshot.ts` wrote (`apt-bundle.ts`): every file it
 * names (frozen indexes and the selected packages) is fetched by its checksum — from `--apt-files` (the snapshot step's
 * blob directory) if there, else from the source's upstream — verified (size + SHA-256), deduplicated and packed per OS
 * into `artifacts/apt/packages-<os>.tar` (manifest `aptPackages`, signed with everything else).
 *
 * Release builds keep the key out of the build (M6 review L5): `--defer-signature` builds without it and leaves
 * `<name>.manifest.json` and `<name>.artifacts.tar` in `--out`; then, in a separate step that is the only one with the
 * key, `node tmp/lw-release/build-bundle.cjs --sign-deferred --release <v> --out <dir>` signs the manifest and
 * assembles `<name>.tar` (no network, no other code).
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';

import {
  aptBundleIndexSchema,
  aptPackPath,
  buildManifest,
  collectAptBundleBlobs,
  canonicalJson,
  DRBD_PIN,
  GVISOR_ARCH,
  GVISOR_PIN,
  inspectDrbdCompatEntry,
  isPrerelease,
  MANIFEST_ENTRY,
  NODE_ARCHES,
  normalizeVersion,
  SIGNATURE_ENTRY,
  signManifest,
  TAR_END,
  tarHeader,
  tarPadding,
  type ArtifactFile,
  type ImageComponentName,
  type NodeArch,
  writeAptPack,
} from '../src';

const { values } = parseArgs({
  options: {
    release: { type: 'string' },
    channel: { type: 'string' },
    out: { type: 'string', default: 'dist/loadweaver-bundle' },
    'control-plane-image': { type: 'string' },
    'opensearch-image': { type: 'string' },
    'console-image': { type: 'string' },
    'agent-amd64': { type: 'string' },
    'agent-arm64': { type: 'string' },
    'image-archive': { type: 'string', multiple: true },
    gvisor: { type: 'boolean' },
    'drbd-source': { type: 'boolean' },
    'drbd-prebuilt': { type: 'string', multiple: true },
    'drbd-compat': { type: 'string', multiple: true },
    'apt-snapshot': { type: 'string' },
    'apt-files': { type: 'string' },
    note: { type: 'string', multiple: true },
    'minimum-version': { type: 'string' },
    'require-signature': { type: 'boolean' },
    'defer-signature': { type: 'boolean' },
    'sign-deferred': { type: 'boolean' },
  },
});

function fail(message: string): never {
  console.error(`build-bundle: ${message}`);
  process.exit(1);
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');

  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);

  return hash.digest('hex');
}

async function download(url: string, target: string, check: { sha256?: string; sha512?: string }): Promise<void> {
  const res = await fetch(url, { redirect: 'follow' });

  if (!res.ok || !res.body) fail(`download of ${url} failed: HTTP ${res.status}`);

  await pipeline(res.body as unknown as NodeJS.ReadableStream, createWriteStream(target));

  const data = readFileSync(target);

  if (check.sha256 && createHash('sha256').update(data).digest('hex') !== check.sha256)
    fail(`${url}: SHA-256 mismatch`);

  if (check.sha512 && createHash('sha512').update(data).digest('hex') !== check.sha512)
    fail(`${url}: SHA-512 mismatch`);
}

async function main(): Promise<void> {
  const version =
    normalizeVersion(values.release ?? process.env['VERSION'] ?? '') ?? fail('--release (or VERSION) is required');
  const channel = (values.channel ?? (isPrerelease(version) ? 'beta' : 'stable')) as 'stable' | 'beta';
  const out = resolve(values.out as string);
  const work = join(out, 'work');
  const name = `loadweaver-bundle-${version}`;

  if (values['sign-deferred']) return await signDeferred(out, name);

  const deferred = !!values['defer-signature'];
  const key = deferred ? undefined : process.env['LOADWEAVER_RELEASE_SIGNING_KEY'];

  if (values['require-signature'] && !key && !deferred) fail('LOADWEAVER_RELEASE_SIGNING_KEY is not set');

  if (!values['control-plane-image']) fail('--control-plane-image <ref@sha256:…> is required');

  mkdirSync(work, { recursive: true });

  /** Bundle path → local file. */
  const files = new Map<string, string>();
  const add = async (bundlePath: string, local: string): Promise<ArtifactFile> => {
    files.set(bundlePath, local);

    return { path: bundlePath, sha256: await sha256File(local), size: statSync(local).size };
  };

  const agentBinaries: Partial<Record<NodeArch, ArtifactFile>> = {};

  for (const arch of NODE_ARCHES) {
    const local = values[`agent-${arch}` as 'agent-amd64'];

    if (local) agentBinaries[arch] = await add(`artifacts/bin/loadweaver-agent-linux-${arch}`, local);
  }

  if (!Object.keys(agentBinaries).length) fail('give at least one --agent-<arch> binary');

  const imageArchives: Partial<Record<ImageComponentName, ArtifactFile>> = {};

  for (const spec of values['image-archive'] ?? []) {
    const [name, local] = spec.split('=');

    if (!name || !local) fail(`--image-archive ${spec}: expected <component>=<oci archive>`);

    imageArchives[name as ImageComponentName] = await add(`artifacts/images/${name}.oci.tar`, local);
  }

  const gvisorTarballs: Partial<Record<NodeArch, ArtifactFile>> = {};

  if (values.gvisor)
    for (const arch of NODE_ARCHES) {
      const target = join(work, `gvisor-${arch}.tar.bz2`);

      await download(
        GVISOR_PIN.urlTemplate.replace('{release}', GVISOR_PIN.release).replace('{arch}', GVISOR_ARCH[arch]),
        target,
        { sha512: GVISOR_PIN.sha512[arch] },
      );
      gvisorTarballs[arch] = await add(`artifacts/gvisor/${arch}/gvisor.tar.bz2`, target);
    }

  let drbdSource: ArtifactFile | undefined;

  if (values['drbd-source']) {
    const target = join(work, basename(DRBD_PIN.url));

    await download(DRBD_PIN.url, target, { sha256: DRBD_PIN.sha256 });
    drbdSource = await add(`artifacts/drbd/${basename(DRBD_PIN.url)}`, target);
  }

  const drbdPrebuilt = [];

  for (const spec of values['drbd-prebuilt'] ?? []) {
    const match =
      /^([0-9A-Za-z._+~-]+):(amd64|arm64)=(.+)$/.exec(spec) ?? fail(`--drbd-prebuilt ${spec}: <kernel>:<arch>=<file>`);

    drbdPrebuilt.push({
      kernel: match[1],
      arch: match[2] as NodeArch,
      file: await add(`artifacts/drbd/${match[1]}-${match[2]}.tar.gz`, match[3]),
      signed: false,
    });
  }

  const drbdCompat: { kernel: string; arch: NodeArch; file: ArtifactFile; md5: string }[] = [];

  for (const spec of values['drbd-compat'] ?? []) {
    const match =
      /^([0-9A-Za-z._+~-]+):(amd64|arm64)=(.+)$/.exec(spec) ?? fail(`--drbd-compat ${spec}: <kernel>:<arch>=<file>`);
    const entry = await inspectDrbdCompatEntry(readFileSync(match[3]), match[1]).catch((error: unknown) =>
      fail(`--drbd-compat ${spec}: ${error instanceof Error ? error.message : String(error)}`),
    );

    // One kernel release can come from two OS releases (Ubuntu 22.04 HWE / 24.04): one entry per distinct compat.h.
    if (drbdCompat.some((c) => c.kernel === match[1] && c.arch === match[2] && c.md5 === entry.md5)) continue;

    drbdCompat.push({
      kernel: match[1],
      arch: match[2] as NodeArch,
      file: await add(`artifacts/drbd/compat/${match[1]}-${match[2]}-${entry.md5}.tar.gz`, match[3]),
      md5: entry.md5,
    });
  }

  if (drbdCompat.length && !drbdSource) fail('--drbd-compat needs --drbd-source (the patches apply to that source)');

  const aptSnapshot = values['apt-snapshot']
    ? await add('artifacts/apt/snapshot.json', values['apt-snapshot'])
    : undefined;
  const aptPackages: ArtifactFile[] = [];

  if (values['apt-snapshot']) {
    // The files the index names, by checksum (verified), packed per OS: an air-gapped cluster serves OS updates from them.
    const parsed = aptBundleIndexSchema.safeParse(JSON.parse(readFileSync(values['apt-snapshot'], 'utf8')));

    if (!parsed.success) fail(`--apt-snapshot: ${parsed.error.issues[0]?.message ?? 'invalid index'}`);

    const groups = await collectAptBundleBlobs(parsed.data, {
      workDir: join(work, 'apt'),
      ...(values['apt-files'] ? { cacheDir: resolve(values['apt-files']) } : {}),
    });

    for (const group of groups) {
      const local = join(work, basename(aptPackPath(group.os)));

      await writeAptPack(local, group.blobs);
      aptPackages.push(await add(aptPackPath(group.os), local));
      console.log(
        `apt ${group.os}: ${group.blobs.length} files, ${(group.blobs.reduce((n, b) => n + b.size, 0) / 1024 ** 2).toFixed(0)} MiB`,
      );
    }
    // The fetched packages are in the packs now (peak disk use on the release runner).
    rmSync(join(work, 'apt'), { recursive: true, force: true });
  } else if (values['apt-files']) fail('--apt-files needs --apt-snapshot');
  const manifest = buildManifest({
    version,
    channel,
    created: new Date().toISOString(),
    notes: values.note ?? [],
    ...(values['minimum-version'] ? { minimumVersion: values['minimum-version'] } : {}),
    images: {
      'control-plane': values['control-plane-image'],
      ...(values['opensearch-image'] ? { opensearch: values['opensearch-image'] } : {}),
    },
    opensearchWithRepositoryS3: !!values['opensearch-image'],
    ...(values['console-image'] ? { consoleImage: values['console-image'] } : {}),
    imageArchives,
    agentBinaries,
    ...(values.gvisor ? { gvisorTarballs } : {}),
    ...(drbdSource ? { drbdSource } : {}),
    drbdPrebuilt,
    ...(drbdCompat.length ? { drbdCompat } : {}),
    ...(aptSnapshot ? { aptSnapshot } : {}),
    ...(aptPackages.length ? { aptPackages } : {}),
  });
  const manifestBytes = Buffer.from(canonicalJson(manifest));

  writeFileSync(join(out, `${name}.manifest.json`), manifestBytes);

  if (deferred) {
    // The artifacts part of the tar; `--sign-deferred` puts the manifest and its signature in front.
    await writeTar(
      join(out, `${name}.artifacts.tar`),
      [],
      manifest.artifacts.map((a) => ({ entry: a.path, size: a.size, local: files.get(a.path) as string })),
      true,
    );
    console.log(`${name}: ${manifest.artifacts.length} artifacts, signature deferred (run --sign-deferred)`);

    return;
  }

  const signature = key ? Buffer.from(JSON.stringify(signManifest(manifestBytes, key))) : null;

  await writeTar(
    join(out, `${name}.tar`),
    [[MANIFEST_ENTRY, manifestBytes], ...(signature ? [[SIGNATURE_ENTRY, signature] as [string, Buffer]] : [])],
    manifest.artifacts.map((a) => ({ entry: a.path, size: a.size, local: files.get(a.path) as string })),
    true,
  );
  await finish(out, name, signature, manifest.artifacts.length);
}

/** Writes a tar: small in-memory entries, then file entries, then (if `end`) the end-of-archive blocks. */
async function writeTar(
  path: string,
  head: [string, Buffer][],
  entries: { entry: string; size: number; local: string }[],
  end: boolean,
  raw?: string,
): Promise<void> {
  const tar = createWriteStream(path);
  const write = (chunk: Buffer) =>
    new Promise<void>((done, reject) => tar.write(chunk, (error) => (error ? reject(error) : done())));

  for (const [entry, data] of head) {
    await write(tarHeader(entry, data.length));
    await write(data);
    await write(tarPadding(data.length));
  }

  for (const entry of entries) {
    await write(tarHeader(entry.entry, entry.size));

    for await (const chunk of createReadStream(entry.local)) await write(chunk as Buffer);

    await write(tarPadding(entry.size));
  }

  // An already formatted tar part (entries + end blocks) appended as it is.
  if (raw) for await (const chunk of createReadStream(raw)) await write(chunk as Buffer);

  if (end) await write(TAR_END);

  await new Promise<void>((done) => tar.end(done));
}

async function finish(out: string, name: string, signature: Buffer | null, artifacts: number): Promise<void> {
  if (signature) writeFileSync(join(out, `${name}.manifest.sig`), signature);

  writeFileSync(join(out, `${name}.tar.sha256`), `${await sha256File(join(out, `${name}.tar`))}  ${name}.tar\n`);
  console.log(
    `${name}.tar: ${artifacts} artifacts, ${signature ? `signed (key ${JSON.parse(signature.toString()).keyId})` : 'UNSIGNED (development only)'}`,
  );
}

/** `--sign-deferred`: signs the manifest a `--defer-signature` build left and assembles the bundle tar. */
async function signDeferred(out: string, name: string): Promise<void> {
  const key = process.env['LOADWEAVER_RELEASE_SIGNING_KEY'] ?? fail('LOADWEAVER_RELEASE_SIGNING_KEY is not set');
  const manifestBytes = readFileSync(join(out, `${name}.manifest.json`));
  const artifacts = (JSON.parse(manifestBytes.toString('utf8')) as { artifacts: unknown[] }).artifacts.length;
  const signature = Buffer.from(JSON.stringify(signManifest(manifestBytes, key)));
  const body = join(out, `${name}.artifacts.tar`);

  await writeTar(
    join(out, `${name}.tar`),
    [
      [MANIFEST_ENTRY, manifestBytes],
      [SIGNATURE_ENTRY, signature],
    ],
    [],
    false,
    body,
  );
  rmSync(body);
  await finish(out, name, signature, artifacts);
}

main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
