import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import {
  buildPackageArchive,
  generateSigningKeyPair,
  hasLintErrors,
  loadPackage,
  parseManifest,
  sha256Digest,
  signBlob,
  verifyBlob,
  verifyIndex,
  verifyPackage,
  type SigningKeyType,
} from '@forepath/loadweaver/shared/util-app-catalog';
import { parse as parseYaml } from 'yaml';

import { bumpPackage, registryDigestResolver } from './bump';
import { buildCatalogIndex, loadCatalog, PACKAGE_SIGNATURE_FILE, type BuiltCatalog } from './catalog';
import { loadPublicKeys, loadSigningKey, type SigningKey } from './keys';
import {
  OciRegistryClient,
  PACKAGE_OCI_SIGNATURE_FILE,
  packageArtifact,
  packageRepository,
  parseOciTarget,
  planOciPublish,
  pushOciPublish,
  simpleSigningPayload,
} from './oci';
import {
  deploymentDocument,
  formatFinding,
  initPackage,
  lintPackageFiles,
  readPackageDir,
  validatePackage,
} from './package-dir';

type Out = (line: string) => void;

export const APP_USAGE = `loadweaver app — build, sign and publish app store packages

  loadweaver app init <name> [-o <dir>] [--version 0.1.0] [--publisher <name>]
  loadweaver app validate [dir] [--set k=v ...] [--values <file.yaml>] [--render <compose.yaml>]
             [--deployment <deployment.yaml>] [--project <project>]
  loadweaver app lint [dir] [--json]
  loadweaver app package [dir] [-o <file.tar.gz>]
  loadweaver app sign <file> [--key <pem | env:VAR>] [--passphrase-env VAR] [-o <file.sig>] [--oci oci://<repo>]
  loadweaver app keygen -o <prefix> [--type ecdsa-p256|ed25519]
  loadweaver app index build <catalog-dir> [--key <pem>] [--package-key <pem>] [-o <dir>] [--now <iso time>]
  loadweaver app publish oci <catalog-dir> [--repo oci://<registry>/<repository>] [--key <pem>] [--package-key <pem>]
             [--dry-run] [--force] [--username <user>]
  loadweaver app verify <package.tar.gz | index.yaml | dir> [--key <public key | dir> ...] [--require-signatures]
  loadweaver app bump <package dir> --version <new version> [-o <dir>]
             (copies a version; images tagged with the old version are re-pinned to the new tag's digest)

Keys: --key takes a PEM file or env:VAR; without it LW_APP_SIGNING_KEY holds the PEM. Encrypted PKCS#8 keys read
their passphrase from LW_APP_SIGNING_KEY_PASSPHRASE (or --passphrase-env). Registry credentials for publish:
LW_REGISTRY_USERNAME / LW_REGISTRY_PASSWORD (e.g. the GitHub actor and token for ghcr.io).`;

function parseSet(entries: readonly string[]): Record<string, unknown> {
  const values: Record<string, unknown> = {};

  for (const entry of entries) {
    const eq = entry.indexOf('=');

    if (eq <= 0) throw new Error(`--set ${entry}: expected name=value`);

    values[entry.slice(0, eq)] = entry.slice(eq + 1);
  }

  return values;
}

async function isDirectory(path: string): Promise<boolean> {
  return stat(path).then(
    (s) => s.isDirectory(),
    () => false,
  );
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

async function signingKey(
  key: readonly string[] | undefined,
  passphraseEnv: string | undefined,
  env: NodeJS.ProcessEnv,
): Promise<SigningKey> {
  if (key && key.length > 1) throw new Error('pass one --key to sign with');

  return loadSigningKey({ key: key?.[0], passphraseEnv }, env);
}

export async function appCommand(argv: string[], out: Out, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: 'string', short: 'o' },
      key: { type: 'string', multiple: true },
      'package-key': { type: 'string' },
      'passphrase-env': { type: 'string' },
      set: { type: 'string', multiple: true },
      values: { type: 'string' },
      render: { type: 'string' },
      deployment: { type: 'string' },
      project: { type: 'string' },
      json: { type: 'boolean' },
      version: { type: 'string' },
      publisher: { type: 'string' },
      repo: { type: 'string' },
      'dry-run': { type: 'boolean' },
      force: { type: 'boolean' },
      now: { type: 'string' },
      signature: { type: 'string' },
      oci: { type: 'string' },
      type: { type: 'string' },
      'require-signatures': { type: 'boolean' },
      username: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [command, ...args] = positionals;

  if (values.help) {
    out(APP_USAGE);

    return;
  }

  switch (command) {
    case 'init': {
      if (!args[0]) throw new Error('app init <name>');

      const dir = values.out ?? args[0];
      const written = await initPackage(args[0], dir, { version: values.version, publisher: values.publisher });

      written.forEach((file) => out(`created ${file}`));
      out(`next: edit the files, then \`loadweaver app validate ${dir}\` and \`loadweaver app lint ${dir}\``);

      return;
    }
    case 'validate': {
      const dir = args[0] ?? '.';
      let given: Record<string, unknown> = {};

      if (values.values) {
        const parsed = parseYaml(await readFile(values.values, 'utf8')) as unknown;

        if (parsed !== null && (typeof parsed !== 'object' || Array.isArray(parsed)))
          throw new Error(`${values.values} must be a map of parameter values`);

        given = (parsed as Record<string, unknown>) ?? {};
      }

      const result = validatePackage(
        await readPackageDir(dir),
        { ...given, ...parseSet(values.set ?? []) },
        values.project,
      );

      result.warnings.forEach((w) => out(`warning ${w}`));
      result.errors.forEach((e) => out(`error   ${e}`));

      const rendered = result.variants[0]?.compose;

      if (values.render && rendered) await writeFile(values.render, rendered);

      if (values.deployment && rendered && result.manifest)
        await writeFile(values.deployment, deploymentDocument(result.manifest, rendered, values.project));

      if (result.errors.length > 0) throw new Error(`${dir}: ${result.errors.length} validation error(s)`);

      out(
        `${dir}: ${result.manifest?.name} ${result.manifest?.version} is valid ` +
          `(rendered: ${result.variants.map((v) => v.name).join(', ')})`,
      );

      return;
    }
    case 'lint': {
      const dir = args[0] ?? '.';
      const findings = lintPackageFiles(await readPackageDir(dir));

      if (values.json) out(JSON.stringify(findings, null, 2));
      else findings.forEach((f) => out(formatFinding(f)));

      const errors = findings.filter((f) => f.severity === 'error').length;

      if (hasLintErrors(findings)) throw new Error(`${dir}: ${errors} lint error(s)`);

      if (!values.json) out(`${dir}: lint passed (${findings.length} finding(s), no errors)`);

      return;
    }
    case 'package': {
      const dir = args[0] ?? '.';
      const files = await readPackageDir(dir);
      const manifest = parseManifest(files.manifest);

      if (!manifest.ok) throw new Error(`manifest.yaml: ${manifest.errors.join('; ')}`);

      const archive = buildPackageArchive(files);
      const file = values.out ?? `${manifest.value.name}-${manifest.value.version}.tar.gz`;

      await mkdir(dirname(resolve(file)), { recursive: true });
      await writeFile(file, archive);
      out(
        `${file}: ${manifest.value.name} ${manifest.value.version} ${sha256Digest(archive)} (${archive.length} bytes)`,
      );

      return;
    }
    case 'sign': {
      if (!args[0]) throw new Error('app sign <file> --key <pem>');

      const data = await readFile(args[0]);
      const key = await signingKey(values.key, values['passphrase-env'], env);
      const sigFile = values.out ?? `${args[0]}.sig`;

      await writeFile(sigFile, `${signBlob(data, key.privateKeyPem, key.passphrase)}\n`);
      out(`${sigFile}: signed ${sha256Digest(data)} with key ${key.keyId}`);

      if (values.oci) {
        const loaded = loadPackage(data);

        if (!loaded.ok) throw new Error(`--oci needs a package archive: ${loaded.errors.join('; ')}`);

        const target = parseOciTarget(values.oci);
        const { name, version } = loaded.value.manifest;
        const repository = packageRepository(target, name);
        const artifact = packageArtifact(name, version, data);
        const ociFile = sigFile.replace(/\.sig$/, '') + '.oci.sig';

        await writeFile(
          ociFile,
          `${signBlob(simpleSigningPayload(target, repository, artifact.digest), key.privateKeyPem, key.passphrase)}\n`,
        );
        out(
          `${ociFile}: signed ${target.registry}/${repository}@${artifact.digest} (commit as ${PACKAGE_OCI_SIGNATURE_FILE})`,
        );
      }

      return;
    }
    case 'keygen': {
      if (!values.out) throw new Error('app keygen -o <prefix>');

      const type = (values.type ?? 'ecdsa-p256') as SigningKeyType;

      if (type !== 'ecdsa-p256' && type !== 'ed25519') throw new Error('--type is ecdsa-p256 or ed25519');

      const keyFile = `${values.out}.key`;
      const pubFile = `${values.out}.pub`;

      for (const file of [keyFile, pubFile]) if (await exists(file)) throw new Error(`${file} already exists`);

      const pair = generateSigningKeyPair(type);

      await mkdir(dirname(resolve(keyFile)), { recursive: true });
      await writeFile(keyFile, pair.privateKeyPem, { mode: 0o600, flag: 'wx' });
      await chmod(keyFile, 0o600);
      await writeFile(pubFile, pair.publicKeyPem, { flag: 'wx' });
      out(`${pubFile}: public key ${pair.keyId}`);
      out(`${keyFile}: private key (mode 0600; never commit it)`);

      return;
    }
    case 'index': {
      if (args[0] !== 'build' || !args[1]) throw new Error('app index build <catalog-dir> --key <pem>');

      const built = await buildFromCatalog(args[1], values, env);
      const dir = values.out ?? join('dist', 'app-catalog', built.index.catalog.name);

      await writeGitCatalog(dir, built);
      out(
        `${dir}: index.yaml signed (${built.index.apps.length} app(s), ${built.packages.length} version(s), ` +
          `${built.index.takedowns.length} takedown(s))`,
      );
      built.packages.forEach((p) => out(`  ${p.app} ${p.version} ${p.digest}`));

      return;
    }
    case 'publish': {
      if (args[0] !== 'oci' || !args[1])
        throw new Error('app publish oci <catalog-dir> --repo oci://<registry>/<repo>');

      const catalog = await loadCatalog(args[1]);
      const repo = values.repo ?? catalog.config.oci;

      if (!repo) throw new Error('--repo oci://<registry>/<repository> (or oci: in catalog.yaml)');

      const target = parseOciTarget(repo);
      const catalogKey = await signingKey(values.key, values['passphrase-env'], env);
      const packageKey = values['package-key']
        ? await loadSigningKey({ key: values['package-key'], passphraseEnv: values['passphrase-env'] }, env)
        : undefined;
      const built = buildCatalogIndex(catalog, {
        catalogKey,
        packageKey,
        now: values.now ? new Date(values.now) : undefined,
      });
      const committedSignatures: Record<string, string> = {};

      for (const pkg of catalog.packages) {
        const file = join(pkg.dir, PACKAGE_OCI_SIGNATURE_FILE);

        if (await exists(file))
          committedSignatures[`${pkg.app}/${pkg.version}`] = (await readFile(file, 'utf8')).trim();
      }

      const plan = planOciPublish(catalog, built, { target, catalogKey, packageKey, committedSignatures });

      out(
        `${values['dry-run'] ? 'dry run: would publish' : 'publishing'} ${catalog.config.name} to oci://${target.registry}/${target.repository}`,
      );

      if (values['dry-run']) {
        plan.steps.forEach((s) => out(`  ${s.repository}:${s.tag} ${s.digest} (${s.what})`));

        return;
      }

      const client = new OciRegistryClient(target, {
        username: values.username ?? env['LW_REGISTRY_USERNAME'],
        password: env['LW_REGISTRY_PASSWORD'],
      });

      await pushOciPublish(client, plan, { force: values.force }, out);
      out(`published ${plan.steps.length} artifact(s)`);

      return;
    }
    case 'bump': {
      if (!args[0] || !values.version) throw new Error('app bump <package dir> --version <new version>');

      const dir = args[0].replace(/\/+$/, '');
      const outDir = values.out ?? join(dirname(dir), values.version);
      const result = await bumpPackage(
        dir,
        values.version,
        outDir,
        registryDigestResolver({
          username: values.username ?? env['LW_REGISTRY_USERNAME'],
          password: env['LW_REGISTRY_PASSWORD'],
        }),
      );

      result.replaced.forEach((r) => out(`  ${r.from}\n    -> ${r.to}`));
      out(`${outDir}: ${values.version} (${result.replaced.length} image(s) re-pinned); validate and lint it next`);

      return;
    }
    case 'verify': {
      if (!args[0]) throw new Error('app verify <file | dir> --key <public key>');

      await verify(args[0], values, out);

      return;
    }
    default:
      out(APP_USAGE);
  }
}

async function buildFromCatalog(
  dir: string,
  values: { key?: string[]; 'package-key'?: string; 'passphrase-env'?: string; now?: string },
  env: NodeJS.ProcessEnv,
): Promise<BuiltCatalog> {
  const catalog = await loadCatalog(dir);
  const catalogKey = await signingKey(values.key, values['passphrase-env'], env);
  const packageKey = values['package-key']
    ? await loadSigningKey({ key: values['package-key'], passphraseEnv: values['passphrase-env'] }, env)
    : undefined;

  if (values.now && Number.isNaN(Date.parse(values.now))) throw new Error(`--now ${values.now} is not a time`);

  return buildCatalogIndex(catalog, { catalogKey, packageKey, now: values.now ? new Date(values.now) : undefined });
}

/** Git catalog layout: `index.yaml` + `index.yaml.sig`, `<app>/<version>.tar.gz` + `<app>/<version>.tar.gz.sig`. */
export async function writeGitCatalog(dir: string, built: BuiltCatalog): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'index.yaml'), built.indexYaml);
  await writeFile(join(dir, 'index.yaml.sig'), `${built.indexSignature}\n`);

  for (const pkg of built.packages) {
    await mkdir(join(dir, pkg.app), { recursive: true });
    await writeFile(join(dir, pkg.app, `${pkg.version}.tar.gz`), pkg.archive);
    await writeFile(join(dir, pkg.app, `${pkg.version}.tar.gz.sig`), `${pkg.signature}\n`);
  }
}

async function readSignature(file: string, explicit?: string): Promise<string> {
  const path = explicit ?? `${file}.sig`;

  try {
    return (await readFile(path, 'utf8')).trim();
  } catch {
    throw new Error(`${path} is missing (pass --signature <file>)`);
  }
}

async function verify(
  target: string,
  values: { key?: string[]; signature?: string; 'require-signatures'?: boolean },
  out: Out,
): Promise<void> {
  const keys = values.key?.length ? await loadPublicKeys(values.key) : [];

  if (await isDirectory(target)) {
    if (await exists(join(target, 'catalog.yaml'))) return verifySourceCatalog(target, values, out);

    if (await exists(join(target, 'index.yaml'))) return verifyGitCatalog(target, keys, out);

    if (await exists(join(target, 'manifest.yaml'))) {
      if (keys.length === 0) throw new Error('--key <public key> to verify against');

      const archive = buildPackageArchive(await readPackageDir(target));
      const verified = verifyBlob(archive, await readSignature(join(target, 'package'), values.signature), keys);

      if (!verified.ok) throw new Error(`${target}: ${verified.errors.join('; ')}`);

      out(`${target}: ${sha256Digest(archive)} signed by ${verified.value.keyId}`);

      return;
    }

    throw new Error(`${target}: no catalog.yaml, index.yaml or manifest.yaml`);
  }

  if (keys.length === 0) throw new Error('--key <public key> to verify against');

  const data = await readFile(target);
  const signature = await readSignature(target, values.signature);

  if (basename(target).endsWith('.yaml')) {
    const verified = verifyIndex(data, { kind: 'blob', signature }, keys);

    if (!verified.ok) throw new Error(`${target}: ${verified.errors.join('; ')}`);

    out(
      `${target}: ${verified.value.index.catalog.name} index signed by ${verified.value.keyId} ` +
        `(${verified.value.index.apps.length} app(s))`,
    );

    return;
  }

  const verified = verifyBlob(data, signature, keys);

  if (!verified.ok) throw new Error(`${target}: ${verified.errors.join('; ')}`);

  const loaded = loadPackage(data);

  if (!loaded.ok) throw new Error(`${target}: ${loaded.errors.join('; ')}`);

  out(
    `${target}: ${loaded.value.manifest.name} ${loaded.value.manifest.version} ${loaded.value.digest} ` +
      `signed by ${verified.value.keyId}`,
  );
}

async function verifyGitCatalog(dir: string, keys: string[], out: Out): Promise<void> {
  if (keys.length === 0) throw new Error('--key <catalog public key> to verify the index against');

  const indexBytes = await readFile(join(dir, 'index.yaml'));
  const index = verifyIndex(
    indexBytes,
    { kind: 'blob', signature: await readSignature(join(dir, 'index.yaml')) },
    keys,
  );

  if (!index.ok) throw new Error(index.errors.join('\n'));

  const errors: string[] = [];
  let count = 0;

  for (const app of index.value.index.apps) {
    for (const v of app.versions) {
      const file = join(dir, app.name, `${v.version}.tar.gz`);

      try {
        const result = verifyPackage({
          index: index.value.index,
          app: app.name,
          version: v.version,
          archive: await readFile(file),
          signature: { kind: 'blob', signature: await readSignature(file) },
        });

        if (result.ok) count++;
        else errors.push(...result.errors);
      } catch (error) {
        errors.push(`${app.name} ${v.version}: ${(error as Error).message}`);
      }
    }
  }

  if (errors.length > 0) throw new Error(`${dir}:\n  ${errors.join('\n  ')}`);

  out(`${dir}: index signed by ${index.value.keyId}; ${count} package(s) verified`);
}

/** A catalog source folder: committed `package.sig` files against the registered publisher keys. */
async function verifySourceCatalog(dir: string, values: { 'require-signatures'?: boolean }, out: Out): Promise<void> {
  const catalog = await loadCatalog(dir);
  const errors = [...catalog.errors];
  let signed = 0;

  for (const pkg of catalog.packages) {
    const where = `${pkg.app}/${pkg.version}`;

    if (!pkg.manifest) continue;

    if (!pkg.signature) {
      if (values['require-signatures']) errors.push(`${where}: ${PACKAGE_SIGNATURE_FILE} is missing`);
      else out(`${where}: unsigned (signed by the catalog key at publish)`);

      continue;
    }

    const keys = Object.values(catalog.publishers)
      .filter((p) => p.name === pkg.manifest?.publisher)
      .map((p) => p.publicKey);
    const archive = buildPackageArchive(pkg.files);
    const verified = verifyBlob(archive, pkg.signature, keys);

    if (!verified.ok)
      errors.push(`${where}: ${verified.errors.join('; ')} (archive ${sha256Digest(archive)}; re-sign after changes)`);
    else {
      signed++;
      out(`${where}: ${sha256Digest(archive)} signed by ${pkg.manifest.publisher} (${verified.value.keyId})`);
    }
  }

  if (errors.length > 0) throw new Error(`${dir}:\n  ${errors.join('\n  ')}`);

  out(`${dir}: ${catalog.packages.length} package(s), ${signed} with a valid publisher signature`);
}
