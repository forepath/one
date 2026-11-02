/**
 * Verification helpers for the official Node.js binaries that package-provider.mjs injects the provider into.
 *
 * Trust chain: the Node.js release keys' fingerprints are pinned below → `SHASUMS256.txt.sig` must carry a valid
 * signature by one of them (`gpg --verify` in a throw-away GNUPGHOME, primary fingerprint from `VALIDSIG`) → the
 * archive must match its line in the signed `SHASUMS256.txt` → the binary extracted from it is cached per verified
 * archive hash with its own hash and re-hashed on every use.
 *
 * Release keys: fingerprints from https://github.com/nodejs/release-keys (`keys.list`, every key that ever signed a
 * Node.js release, so older versions verify too) at the pinned commit; the public keys are fetched from that commit
 * at build time (not vendored). Only the fingerprints are trusted, not the download: a key whose fingerprint isn't
 * listed can never satisfy the check.
 *
 * Plain CommonJS with injected `fs` / hash / process helpers so the logic is unit-testable (src/node-dist-verify.spec.ts).
 */
'use strict';

const { join } = require('node:path');

const NODE_RELEASE_KEYS_COMMIT = '481637f813e912c4aa3622d7964ab426c97b8e8d';

const NODE_RELEASE_KEY_FINGERPRINTS = Object.freeze([
  '4ED778F539E3634C779C87C6D7062848A1AB005C',
  '94AE36675C464D64BAFA68DD7434390BDBE9B9C5',
  '1C050899334244A8AF75E53792EF661D867B9DFA',
  'B9AE9905FFD7803F25714661B63B535A4C206CA9',
  '77984A986EBC2AA786BC0F66B01FBB92821C587A',
  '71DCFD284A79C3B38668286BC97EC7A07EDE3FC1',
  '61FC681DFB92A079F1685E77973F295594EC4689',
  'FD3A5288F042B6850C66B31F09FE44734EB7990E',
  '8FCCA13FEF1D0C2E91008E09770F7A9A5AE15600',
  'C4F0DFFF4E8C1A8236409D08E73BC641CC11F4C8',
  '890C08DB8579162FEE0DF9DB8BEAB4DFCF555EF4',
  'C82FA3AE1CBEDC6BE46B9360C43CEC45C17AB93C',
  'DD8F2338BAE7501E3DD5AC78C273792F7D83545D',
  'A48C2BEE680E841632CD4E44F07496B3EB3C1762',
  'B9E2F5981AA6E0CD28160D9FF13993A75599653C',
  '108F52B48DB57BB0CC439B2997B01419BD92F80A',
  '9554F04D7259F04124DE6B476D5A82AC7E37093B',
  '93C7E9E91B49E432C2F75674B0A78B0A6C481CF6',
  '56730D5401028683275BD23C23EFEFE93C4CFFFE',
  '114F43EE0176B71C7BC219DD50A3051F888C628D',
  '7937DFD2AB06298B2293C3187D33FF9D0246406D',
  '74F12602B6F1C4E913FAA37AD3A89613643B6201',
  '141F07595B7B3FFE74309A937405533BE57C7D57',
  'DD792F5973C6DE52C432CBDAC77ABFA00DDBF2B7',
  'A363A499291CBBC940DD62E41F10027AF002F8B0',
  'CC68F5A3106FF448322E48ED27F5E38D5B0A215F',
  'C0D6248439F1D5604AAFFB4021D900FFDB233756',
  '5BE8A3F6C8A5C01D106C0AD820B1A390B168D356',
  '655F3B5C1FB3FA8D1A0CA6BDE4A7D232B936D2FD',
]);

const HEX64 = /^[0-9a-f]{64}$/;

function releaseKeyUrl(fingerprint) {
  return `https://raw.githubusercontent.com/nodejs/release-keys/${NODE_RELEASE_KEYS_COMMIT}/keys/${fingerprint}.asc`;
}

/** The SHA-256 of `name` in a SHASUMS256.txt, or `null`. */
function shasumFor(text, name) {
  for (const line of String(text).split('\n')) {
    const [hash, file] = line.trim().split(/\s+/);

    if (file === name && HEX64.test(hash ?? '')) return hash;
  }

  return null;
}

/**
 * Checks `gpg --status-fd` output of a detached-signature verification: a `VALIDSIG` whose primary key fingerprint
 * is pinned, and no bad / revoked / erroring signature next to it.
 */
function checkGpgStatus(status, pinned = NODE_RELEASE_KEY_FINGERPRINTS) {
  const lines = String(status)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('[GNUPG:] '))
    .map((l) => l.slice(9).split(/\s+/));
  const bad = lines.find(([kw]) =>
    ['BADSIG', 'ERRSIG', 'REVKEYSIG', 'NODATA', 'FAILURE'].includes(kw),
  );

  if (bad) return { ok: false, reason: `gpg reported ${bad[0]}` };

  const valid = lines.filter(([kw]) => kw === 'VALIDSIG');

  if (valid.length !== 1)
    return {
      ok: false,
      reason: `expected one valid signature, gpg reported ${valid.length}`,
    };

  // VALIDSIG <fpr> <date> <ts> <expire> <version> <reserved> <pk-algo> <hash-algo> <class> <primary-fpr>
  const fields = valid[0];
  const primary = (fields[10] ?? fields[1] ?? '').toUpperCase();

  if (!pinned.includes(primary))
    return {
      ok: false,
      reason: `signed by ${primary}, which is not a pinned Node.js release key`,
    };

  return { ok: true, fingerprint: primary };
}

/**
 * Whether / how to check the SHASUMS signature: `verify` with gpg, `skip` only with the explicit opt-out (never in
 * CI), otherwise an error (fail closed).
 */
function signatureMode({ hasGpg, allowUnsigned }) {
  if (hasGpg) return { mode: 'verify' };

  if (allowUnsigned) return { mode: 'skip' };

  return {
    mode: 'error',
    message:
      'gpg is required to verify the Node.js SHASUMS256.txt signature (install gnupg). Only for local experiments: --allow-unsigned-node-sums (CI must not pass it).',
  };
}

/**
 * Refuses a cache directory another user could have prepared (the default lives in the shared temp dir): it must be
 * owned by the current user and not writable by group / others. Creates it 0700 if missing.
 */
function ensurePrivateCacheDir({ fs, dir, uid }) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

    return;
  }

  const stat = fs.lstatSync(dir);

  if (!stat.isDirectory())
    throw new Error(`node cache ${dir} is not a directory`);

  if (uid !== undefined && uid !== null && stat.uid !== uid)
    throw new Error(
      `node cache ${dir} is owned by uid ${stat.uid}, not by the current user`,
    );

  if (uid !== undefined && uid !== null && (stat.mode & 0o022) !== 0)
    throw new Error(
      `node cache ${dir} is writable by group / others (mode ${(stat.mode & 0o777).toString(8)})`,
    );
}

/** `true` if `file` exists and hashes to `expected`. */
function fileMatches({ fs, hash, file, expected }) {
  return fs.existsSync(file) && hash(file) === expected;
}

/**
 * The binary extracted from an archive that was just verified (`archiveHash` = its signed SHA-256): cached under
 * `extracted-<archiveHash>/` next to `<member>.sha256`, the hash taken right after extraction. Every use re-hashes the
 * cached binary; a missing / malformed record or any mismatch discards the directory and extracts again.
 */
function cachedExtractedBinary({
  fs,
  hash,
  extract,
  cache,
  archive,
  archiveHash,
  member,
}) {
  if (!HEX64.test(archiveHash))
    throw new Error(`invalid archive hash ${archiveHash}`);

  const dir = join(cache, `extracted-${archiveHash}`);
  const binary = join(dir, member);
  const record = `${binary}.sha256`;

  if (fs.existsSync(binary) && fs.existsSync(record)) {
    const want = String(fs.readFileSync(record, 'utf8')).trim();

    if (HEX64.test(want) && hash(binary) === want) return binary;
  }

  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  extract(archive, dir, member);

  if (!fs.existsSync(binary))
    throw new Error(`${member} missing in ${archive}`);

  fs.writeFileSync(record, `${hash(binary)}\n`);

  return binary;
}

module.exports = {
  NODE_RELEASE_KEYS_COMMIT,
  NODE_RELEASE_KEY_FINGERPRINTS,
  cachedExtractedBinary,
  checkGpgStatus,
  ensurePrivateCacheDir,
  fileMatches,
  releaseKeyUrl,
  shasumFor,
  signatureMode,
};
