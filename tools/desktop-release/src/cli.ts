/**
 * Shared desktop release pipeline for the ForePath Electron apps (see `tools/desktop-release/README.md`).
 *
 *   config        --app <a>                                   app settings as JSON (+ step outputs in Actions)
 *   sign-macos    --app <a> --arch <arm64|x64>                Developer ID sign + notarize + staple   (key-only step)
 *   zip-macos     --app <a> --arch <arch> --version <v>       download / Squirrel.Mac zip
 *   sign-windows  --app <a> --path <file|dir>… [--top-level]  Authenticode via signtool             (key-only step)
 *   linux-rpm     --app <a> --version <v> [--arch x64]        rpm from the packaged Linux app
 *   channels      --app <a> --version <v>                     channels this release is published to
 *   linux-repo    --app <a> --channels <c,…> --out <dir>      sign rpms + signed apt / rpm repos   (key-only step)
 *   feed          --app <a> --version <v> --channels <c,…> --manifest <file> --out <dir>
 *
 * Every signing command checks its secrets first and, when one is unset, skips with a warning and exits 0. Run via
 * `npx nx run desktop-release:desktop-release -- <command> …`, or in CI the bundle `tmp/desktop-release/desktop-release.cjs`
 * built beforehand (`nx run desktop-release:bundle`) so key-only steps run no nx and fetch nothing.
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { DESKTOP_UPDATE_CHANNELS, type DesktopUpdateChannel } from '@forepath/shared/shared/util-release-signing';

import { desktopApp, updateFeedUrl, type DesktopAppConfig } from './apps';
import { releaseChannels, writeUpdateFeeds } from './lib/feed';
import { buildLinuxRepos, buildRpm } from './lib/linux';
import { signAndNotarizeMac, zipMac } from './lib/macos';
import { consoleLog, missingSecrets, runCommand, setStepOutput } from './lib/process';
import { signWindows } from './lib/windows';

function required(value: string | undefined, flag: string): string {
  if (!value) throw new Error(`${flag} is required`);

  return value;
}

function channelsOf(value: string | undefined): DesktopUpdateChannel[] {
  const list = (value ?? '').split(',').filter(Boolean);

  for (const c of list)
    if (!(DESKTOP_UPDATE_CHANNELS as readonly string[]).includes(c)) throw new Error(`unknown channel: ${c}`);

  return list as DesktopUpdateChannel[];
}

/** True when every secret is set; otherwise warns (the step is skipped, not failed). */
function secretsPresent(app: DesktopAppConfig, step: string, names: readonly string[]): boolean {
  const missing = missingSecrets(names);

  if (missing.length === 0) return true;

  consoleLog.warn(`${app.productName}: ${step} skipped`, `${missing.join(', ')} not set; ${step} is skipped.`);
  setStepOutput('skipped', 'true');

  return false;
}

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  const { values } = parseArgs({
    args: rest,
    options: {
      app: { type: 'string' },
      arch: { type: 'string' },
      version: { type: 'string' },
      path: { type: 'string', multiple: true },
      'top-level': { type: 'boolean' },
      channels: { type: 'string' },
      manifest: { type: 'string' },
      signature: { type: 'string' },
      packages: { type: 'string' },
      out: { type: 'string' },
    },
    strict: true,
  });
  const app = desktopApp(values.app);

  switch (command) {
    case 'config': {
      console.log(JSON.stringify(app, null, 2));
      setStepOutput('nx-project', app.nxProject);
      setStepOutput('dist-dir', app.distDir);
      setStepOutput('product', app.product);

      return;
    }

    case 'sign-macos': {
      const s = app.secrets.macos;

      if (
        !secretsPresent(app, 'macOS signing and notarization', [
          s.certificateP12,
          s.certificatePassword,
          s.apiKeyP8,
          s.apiKeyId,
          s.apiIssuer,
        ])
      )
        return;

      await signAndNotarizeMac(app, { arch: required(values.arch, '--arch') }, runCommand, consoleLog);

      return;
    }

    case 'zip-macos': {
      zipMac(
        app,
        { arch: required(values.arch, '--arch'), version: required(values.version, '--version') },
        runCommand,
        consoleLog,
      );

      return;
    }

    case 'sign-windows': {
      const s = app.secrets.windows;

      if (!secretsPresent(app, 'Authenticode signing', [s.certificatePfx, s.certificatePassword])) return;

      signWindows(app, { paths: values.path ?? [], topLevelOnly: values['top-level'] }, runCommand, consoleLog);

      return;
    }

    case 'linux-rpm': {
      buildRpm(
        app,
        { version: required(values.version, '--version'), arch: values.arch ?? 'x64' },
        runCommand,
        consoleLog,
      );

      return;
    }

    case 'channels': {
      const channels = await releaseChannels(app, required(values.version, '--version'));

      console.log(channels.join(','));
      setStepOutput('channels', channels.join(','));

      return;
    }

    case 'linux-repo': {
      const channels = channelsOf(values.channels);

      if (!channels.length) {
        consoleLog.warn(`${app.productName}: package repositories unchanged`, 'no channel to publish this release to.');

        return;
      }

      if (
        !secretsPresent(app, 'Linux package signing and the apt / rpm repositories', [app.secrets.linux.gpgPrivateKey])
      )
        return;

      buildLinuxRepos(
        app,
        {
          channels,
          packagesDir: values.packages ?? `${app.distDir}/out/make`,
          outDir: required(values.out, '--out'),
        },
        runCommand,
        consoleLog,
      );

      return;
    }

    case 'feed': {
      const version = required(values.version, '--version');
      const manifest = required(values.manifest, '--manifest');
      const feeds = writeUpdateFeeds(app, {
        version,
        channels: channelsOf(values.channels),
        manifestBytes: readFileSync(manifest),
        signature: JSON.parse(readFileSync(values.signature ?? `${manifest}.sig`, 'utf8')),
        outDir: required(values.out, '--out'),
      });

      for (const feed of feeds) consoleLog.info(`feed ${updateFeedUrl(app, feed.channel)} → ${feed.version}`);

      return;
    }

    default:
      throw new Error(`unknown command: ${command ?? '(none)'}`);
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(`desktop-release: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
