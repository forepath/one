import { createHash, randomBytes } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { basename, dirname, join } from 'node:path';

import { RELEASE_SIGNING_KEYS } from '@forepath/shared/shared/util-release-keys';
import {
  evaluateDesktopUpdate,
  parseDesktopUpdateFeed,
  verifyDesktopUpdateDownload,
  type DesktopUpdateChannel,
  type DesktopUpdateDecision,
  type ReleaseFile,
} from '@forepath/shared/shared/util-release-signing';
import {
  app,
  autoUpdater,
  dialog,
  net,
  shell,
  type BrowserWindow,
  type MessageBoxOptions,
  type MessageBoxReturnValue,
} from 'electron';

import {
  authenticodeAccepts,
  DOWNLOADS_ORIGIN,
  DOWNLOADS_PAGE_URL,
  isNsisInstall,
  linuxInstallKind,
  linuxUpdateInstructions,
  selectUpdateFile,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_FIRST_CHECK_DELAY_MS,
  UPDATE_PRODUCT,
  updateFeedUrl,
  windowsPowerShellPath,
  type AuthenticodeInfo,
} from './update-config';

type Available = Extract<DesktopUpdateDecision, { status: 'available' }>;

/** Squirrel.Mac must have taken the update from the loopback feed by then (zips are a few hundred MB at most). */
const MAC_UPDATE_TIMEOUT_MS = 10 * 60 * 1000;

export interface DesktopUpdaterOptions {
  channel(): DesktopUpdateChannel;
  window(): BrowserWindow | null;
  log(message: string, ...args: unknown[]): void;
}

/** Reads a small response with a hard size cap: refuses an oversized `Content-Length` and stops streaming past it. */
async function fetchBytes(url: string, maxBytes: number): Promise<{ status: number; body: Buffer }> {
  const res = await net.fetch(url, { redirect: 'error', cache: 'no-store' });

  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);

    return { status: res.status, body: Buffer.alloc(0) };
  }

  const tooLarge = () => new Error(`${url}: response larger than ${maxBytes} bytes`);
  const declared = Number(res.headers.get('content-length') ?? NaN);

  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw tooLarge();
  }

  if (!res.body) return { status: res.status, body: Buffer.alloc(0) };

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  for (;;) {
    const { done, value } = await reader.read();

    if (done) break;

    size += value.length;

    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }

    chunks.push(value);
  }

  return { status: res.status, body: Buffer.concat(chunks, size) };
}

/**
 * Streams a download to disk while hashing it; stops as soon as it exceeds the expected size. Keeps the bytes in
 * memory when `keep` is set (the macOS zip is served to Squirrel.Mac from exactly the verified bytes, not a re-read).
 */
async function download(
  url: string,
  file: ReleaseFile,
  target: string,
  keep = false,
): Promise<{ sha256: string; size: number; bytes?: Buffer }> {
  const res = await net.fetch(url, { redirect: 'error', cache: 'no-store' });

  if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status}`);

  const hash = createHash('sha256');
  const out = createWriteStream(target, { mode: 0o600 });
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();

      if (done) break;

      size += value.length;

      if (size > file.size) throw new Error('the download is larger than the signed manifest says');

      hash.update(value);

      if (keep) chunks.push(value);

      if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()));
    }
  } finally {
    await new Promise<void>((r) => out.end(() => r()));
  }

  return { sha256: hash.digest('hex'), size, ...(keep ? { bytes: Buffer.concat(chunks, size) } : {}) };
}

function authenticodeOf(path: string): Promise<AuthenticodeInfo> {
  const script =
    '$s = Get-AuthenticodeSignature -LiteralPath $env:AGENSTRA_SIGNED_FILE; ' +
    '@{ status = [string]$s.Status; subject = if ($s.SignerCertificate) { $s.SignerCertificate.Subject } else { $null } } | ConvertTo-Json -Compress';

  return new Promise((resolve) => {
    execFile(
      windowsPowerShellPath(process.env['SystemRoot'] ?? process.env['SYSTEMROOT']),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { env: { ...process.env, AGENSTRA_SIGNED_FILE: path }, windowsHide: true, timeout: 60_000 },
      (error, stdout) => {
        if (error) return resolve({ status: 'Unknown' });

        try {
          const parsed = JSON.parse(stdout) as { status?: unknown; subject?: unknown };

          resolve({
            status: typeof parsed.status === 'string' && parsed.status ? parsed.status : 'Unknown',
            subject: typeof parsed.subject === 'string' ? parsed.subject : undefined,
          });
        } catch {
          resolve({ status: 'Unknown' });
        }
      },
    );
  });
}

/**
 * In-app updates: fetch the channel's feed, verify the signed release manifest it points to (compiled-in Agenstra
 * keys, product, version, channel, no downgrade), download this platform's file and check it against the manifest's
 * SHA-256 and size, then hand it to the platform installer — Squirrel.Mac (which additionally checks the Developer ID
 * signature) or the NSIS installer (Authenticode publisher check). Linux installs update through apt / dnf.
 */
export class DesktopUpdater {
  private busy = false;
  private offered = new Set<string>();
  private timers: NodeJS.Timeout[] = [];

  constructor(private readonly opts: DesktopUpdaterOptions) {}

  get enabled(): boolean {
    return app.isPackaged && app.getVersion() !== '0.0.0';
  }

  start(): void {
    if (!this.enabled) return;

    this.timers.push(setTimeout(() => void this.check(false), UPDATE_FIRST_CHECK_DELAY_MS));
    this.timers.push(setInterval(() => void this.check(false), UPDATE_CHECK_INTERVAL_MS));
  }

  stop(): void {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
  }

  async check(interactive: boolean): Promise<void> {
    if (!this.enabled) {
      if (interactive) await this.message('info', 'Updates are only available in released builds.');

      return;
    }

    if (this.busy) return;

    this.busy = true;

    try {
      const decision = await this.evaluate();

      this.opts.log('Update check:', decision.status, 'version' in decision ? decision.version : decision.reason);

      if (decision.status === 'available') {
        if (interactive || !this.offered.has(decision.version)) {
          this.offered.add(decision.version);
          await this.offer(decision);
        }

        return;
      }

      if (!interactive) return;

      if (
        decision.status === 'up-to-date' ||
        (decision.status === 'refused' && (decision.code === 'downgrade' || decision.code === 'no-file'))
      )
        await this.message(
          'info',
          `You are running the latest Agenstra release for the ${this.opts.channel()} channel (${app.getVersion()}).`,
        );
      else await this.message('warning', `The update was refused: ${decision.reason}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);

      this.opts.log('Update check failed:', msg);

      if (interactive) await this.message('warning', `Checking for updates failed: ${msg}`);
    } finally {
      this.busy = false;
    }
  }

  private async evaluate(): Promise<DesktopUpdateDecision> {
    const channel = this.opts.channel();
    const feedRes = await fetchBytes(updateFeedUrl(channel), 64 * 1024);

    if (feedRes.status === 404) return { status: 'up-to-date', version: app.getVersion() };

    if (feedRes.status !== 200) throw new Error(`update feed: HTTP ${feedRes.status}`);

    const feedCheck = parseDesktopUpdateFeed(JSON.parse(feedRes.body.toString('utf8')), {
      product: UPDATE_PRODUCT,
      channel,
      trustedOrigin: DOWNLOADS_ORIGIN,
    });

    if ('reason' in feedCheck) return { status: 'refused', code: feedCheck.code, reason: feedCheck.reason };

    const [manifest, signature] = await Promise.all([
      fetchBytes(feedCheck.feed.manifestUrl, 4 * 1024 * 1024),
      fetchBytes(feedCheck.feed.signatureUrl, 4 * 1024),
    ]);

    if (manifest.status !== 200 || signature.status !== 200)
      throw new Error(`release manifest: HTTP ${manifest.status} / ${signature.status}`);

    let signatureJson: unknown;

    try {
      signatureJson = JSON.parse(signature.body.toString('utf8'));
    } catch {
      signatureJson = undefined;
    }

    return evaluateDesktopUpdate({
      product: UPDATE_PRODUCT,
      channel,
      currentVersion: app.getVersion(),
      feed: feedCheck.feed,
      manifestBytes: manifest.body,
      signature: signatureJson,
      trustedKeysPem: RELEASE_SIGNING_KEYS.agenstra,
      selectFile: selectUpdateFile(process.platform, process.arch),
    });
  }

  private async offer(update: Available): Promise<void> {
    if (process.platform === 'linux') {
      const kind = linuxInstallKind(
        process.execPath,
        existsSync('/etc/debian_version'),
        existsSync('/etc/redhat-release'),
      );

      await this.message('info', linuxUpdateInstructions(kind, update.version), kind === 'archive');

      return;
    }

    if (process.platform === 'win32' && !isNsisInstall(readdirSync(dirname(process.execPath)))) {
      await this.message(
        'info',
        `Agenstra ${update.version} is available. Download it from ${DOWNLOADS_PAGE_URL}.`,
        true,
      );

      return;
    }

    const answer = await this.box({
      type: 'info',
      title: 'Update available',
      message: `Agenstra ${update.version} (${update.channel}) is available. You have ${app.getVersion()}.`,
      detail: 'The update is verified against the signed release manifest before it is installed.',
      buttons: ['Download and install', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });

    if (answer.response !== 0) return;

    const dir = join(app.getPath('userData'), 'updates');

    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true, mode: 0o700 });

    const target = join(dir, basename(update.file.path));
    const digest = await download(update.fileUrl, update.file, target, process.platform === 'darwin');
    const verified = verifyDesktopUpdateDownload(update.file, digest);

    if ('reason' in verified) {
      rmSync(target, { force: true });
      throw new Error(verified.reason);
    }

    this.opts.log('Update verified against the signed manifest:', update.file.path, update.keyId);

    if (process.platform === 'win32') await this.installWindows(target, update);
    else if (process.platform === 'darwin' && digest.bytes) await this.installMac(digest.bytes, update);
  }

  private async installWindows(installer: string, update: Available): Promise<void> {
    const [own, downloaded] = await Promise.all([authenticodeOf(process.execPath), authenticodeOf(installer)]);

    if (!authenticodeAccepts(own, downloaded)) {
      rmSync(installer, { force: true });
      throw new Error(`the installer's Authenticode signature is not acceptable (${downloaded.status})`);
    }

    this.opts.log('Starting the verified installer for', update.version);
    spawn(installer, ['/S', '--updated', '--force-run'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    }).unref();
    app.quit();
  }

  /**
   * Squirrel.Mac takes the verified zip from a one-shot loopback feed (random, unguessable path; served from the
   * verified bytes in memory, not re-read from disk) and checks its code signature itself. The feed is closed when
   * Squirrel finishes, fails or stays silent for too long.
   */
  private async installMac(zip: Buffer, update: Available): Promise<void> {
    const token = randomBytes(32).toString('hex');
    const server: Server = createServer((req, res) => {
      const port = (server.address() as { port: number }).port;

      if (req.method !== 'GET') {
        res.writeHead(405).end();
      } else if (req.url === `/${token}/feed`) {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ url: `http://127.0.0.1:${port}/${token}/update.zip`, name: update.version }));
      } else if (req.url === `/${token}/update.zip`) {
        res.writeHead(200, {
          'content-type': 'application/zip',
          'content-length': zip.length,
          'cache-control': 'no-store',
        });
        res.end(zip);
      } else {
        res.writeHead(404).end();
      }
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    const port = (server.address() as { port: number }).port;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            `the update could not be applied (no response from the installer); download it from ${DOWNLOADS_PAGE_URL}`,
          ),
        );
      }, MAC_UPDATE_TIMEOUT_MS);
      const cleanup = () => {
        clearTimeout(timer);
        autoUpdater.removeAllListeners('update-downloaded');
        autoUpdater.removeAllListeners('error');
        server.close();
        server.closeAllConnections();
      };

      autoUpdater.once('update-downloaded', () => {
        cleanup();
        resolve();
      });
      autoUpdater.once('error', (error) => {
        cleanup();
        reject(new Error(`the update could not be applied (${error.message}); download it from ${DOWNLOADS_PAGE_URL}`));
      });
      autoUpdater.setFeedURL({ url: `http://127.0.0.1:${port}/${token}/feed` });
      autoUpdater.checkForUpdates();
    });

    const answer = await this.box({
      type: 'info',
      title: 'Update ready',
      message: `Agenstra ${update.version} is ready to install.`,
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });

    if (answer.response === 0) autoUpdater.quitAndInstall();
  }

  private box(options: MessageBoxOptions): Promise<MessageBoxReturnValue> {
    const win = this.opts.window();

    return win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options);
  }

  private async message(type: 'info' | 'warning', message: string, offerDownloads = false): Promise<void> {
    const answer = await this.box({
      type,
      title: 'Agenstra updates',
      message,
      buttons: offerDownloads ? ['Open downloads', 'Close'] : ['OK'],
      defaultId: 0,
      cancelId: offerDownloads ? 1 : 0,
    });

    if (offerDownloads && answer.response === 0) await shell.openExternal(DOWNLOADS_PAGE_URL);
  }
}
