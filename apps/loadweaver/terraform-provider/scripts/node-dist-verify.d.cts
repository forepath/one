/** Types for node-dist-verify.cjs (used by package-provider.mjs and its spec). */
interface VerifyFs {
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: 'utf8'): string;
  writeFileSync(path: string, data: string): void;
  rmSync(path: string, options: { recursive: boolean; force: boolean }): void;
  mkdirSync(
    path: string,
    options: { recursive: boolean; mode?: number },
  ): unknown;
  lstatSync(path: string): {
    isDirectory(): boolean;
    uid: number;
    mode: number;
  };
}

export const NODE_RELEASE_KEYS_COMMIT: string;
export const NODE_RELEASE_KEY_FINGERPRINTS: readonly string[];
export function releaseKeyUrl(fingerprint: string): string;
export function shasumFor(text: string, name: string): string | null;
export function checkGpgStatus(
  status: string,
  pinned?: readonly string[],
): { ok: true; fingerprint: string } | { ok: false; reason: string };
export function signatureMode(options: {
  hasGpg: boolean;
  allowUnsigned: boolean;
}): { mode: 'verify' } | { mode: 'skip' } | { mode: 'error'; message: string };
export function ensurePrivateCacheDir(options: {
  fs: VerifyFs;
  dir: string;
  uid?: number | null;
}): void;
export function fileMatches(options: {
  fs: VerifyFs;
  hash: (file: string) => string;
  file: string;
  expected: string;
}): boolean;
export function cachedExtractedBinary(options: {
  fs: VerifyFs;
  hash: (file: string) => string;
  extract: (archive: string, dir: string, member: string) => void;
  cache: string;
  archive: string;
  archiveHash: string;
  member: string;
}): string;
