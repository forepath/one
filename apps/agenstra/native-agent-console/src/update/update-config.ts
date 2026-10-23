import type { DesktopUpdateChannel, ReleaseFile } from '@forepath/shared/shared/util-release-signing';

/**
 * Update settings of Agenstra Desktop (shared desktop release pipeline, `tools/desktop-release`: the app entry
 * `agenstra` there publishes the feeds and files named here).
 */
export const UPDATE_PRODUCT = 'agenstra';
export const DOWNLOADS_ORIGIN = 'https://downloads.agenstra.com';
export const UPDATE_FEED_BASE_URL = `${DOWNLOADS_ORIGIN}/updates/desktop`;
export const DOWNLOADS_PAGE_URL = `${DOWNLOADS_ORIGIN}/`;
/** First check shortly after start, then periodically. */
export const UPDATE_FIRST_CHECK_DELAY_MS = 60_000;
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function updateFeedUrl(channel: DesktopUpdateChannel): string {
  return `${UPDATE_FEED_BASE_URL}/${channel}.json`;
}

export function isUpdateChannel(value: unknown): value is DesktopUpdateChannel {
  return value === 'stable' || value === 'beta';
}

/** The configured channel, or the one the installed version came from (a beta build stays on beta). */
export function effectiveUpdateChannel(configured: unknown, currentVersion: string): DesktopUpdateChannel {
  if (isUpdateChannel(configured)) return configured;

  return currentVersion.includes('-') ? 'beta' : 'stable';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The release file an install on this platform updates from (names as the release pipeline publishes them):
 * macOS the Squirrel.Mac zip per arch, Windows the NSIS installer, Linux the deb (only to confirm the release exists
 * for Linux: Linux updates through apt / dnf). Exactly one match, else none.
 */
export function updateFilePattern(platform: NodeJS.Platform, arch: string): RegExp | undefined {
  switch (platform) {
    case 'darwin':
      return arch === 'arm64' || arch === 'x64'
        ? new RegExp(`^desktop/${escapeRegExp(`native-agent-console-darwin-${arch}-`)}[^/]+\\.zip$`)
        : undefined;
    case 'win32':
      return arch === 'x64' ? /^desktop\/agenstra_[^/]+_amd64\.exe$/ : undefined;
    case 'linux':
      return arch === 'x64' ? /^desktop\/agenstra_[^/]+_amd64\.deb$/ : undefined;
    default:
      return undefined;
  }
}

export function selectUpdateFile(
  platform: NodeJS.Platform,
  arch: string,
): (files: readonly ReleaseFile[]) => ReleaseFile | undefined {
  const pattern = updateFilePattern(platform, arch);

  return (files) => {
    const matches = pattern ? files.filter((f) => pattern.test(f.path)) : [];

    return matches.length === 1 ? matches[0] : undefined;
  };
}

export interface AuthenticodeInfo {
  /** `Get-AuthenticodeSignature` status (`Valid`, `NotSigned`, `HashMismatch`, …). */
  status: string;
  subject?: string;
}

/**
 * Whether a downloaded Windows installer may run: a signed install only runs installers validly signed by the same
 * publisher (subject; the thumbprint changes when the certificate is renewed). Only an install that is positively
 * `NotSigned` (built before the Authenticode secret existed) relies on the signed release manifest alone, and it
 * still refuses a broken signature. Any other status of the install (`Unknown` — the check failed or timed out —,
 * `HashMismatch`, …) fails closed.
 */
export function authenticodeAccepts(own: AuthenticodeInfo, update: AuthenticodeInfo): boolean {
  if (own.status === 'NotSigned') return update.status === 'Valid' || update.status === 'NotSigned';

  if (own.status !== 'Valid') return false;

  return update.status === 'Valid' && !!own.subject && update.subject === own.subject;
}

/** Windows PowerShell by absolute path (never resolved through `PATH` / the working directory). */
export function windowsPowerShellPath(systemRoot: string | undefined): string {
  const root =
    systemRoot && /^[A-Za-z]:\\[^"<>|?*]*$/.test(systemRoot) ? systemRoot.replace(/\\+$/, '') : 'C:\\Windows';

  return `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
}

export type LinuxInstallKind = 'apt' | 'dnf' | 'archive';

/** deb / rpm installs live in `/usr/lib/agenstra`; everything else is the zip. */
export function linuxInstallKind(
  exePath: string,
  hasDebianVersion: boolean,
  hasRedhatRelease: boolean,
): LinuxInstallKind {
  if (!exePath.startsWith('/usr/lib/agenstra/')) return 'archive';

  if (hasDebianVersion) return 'apt';

  return hasRedhatRelease ? 'dnf' : 'apt';
}

export function linuxUpdateInstructions(kind: LinuxInstallKind, version: string): string {
  switch (kind) {
    case 'apt':
      return `Agenstra ${version} is available. Install it with your package manager:\n\nsudo apt update && sudo apt install --only-upgrade agenstra`;
    case 'dnf':
      return `Agenstra ${version} is available. Install it with your package manager:\n\nsudo dnf upgrade agenstra`;
    default:
      return `Agenstra ${version} is available. Download it from ${DOWNLOADS_PAGE_URL} or install the apt / rpm package to receive updates through your package manager.`;
  }
}

/** NSIS installs carry their uninstaller next to the executable; the zip doesn't (it updates by download only). */
export function isNsisInstall(filesNextToExe: readonly string[]): boolean {
  return filesNextToExe.some((f) => /^Uninstall .+\.exe$/i.test(f));
}
