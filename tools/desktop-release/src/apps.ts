import type { ReleaseProduct } from '@forepath/shared/shared/util-release-keys';
import type { DesktopUpdateChannel } from '@forepath/shared/shared/util-release-signing';

/**
 * The ForePath Electron apps on the shared desktop release pipeline. Adding an app (e.g. Loadweaver Desktop) is a new
 * entry here plus its matrix entries in `.github/workflows/release.yml`; the steps themselves are app-agnostic.
 *
 * Secrets are referenced by **name** only: the workflow maps the GitHub secret of that name into the environment of
 * the one step that needs it (never into build steps), and every step skips with a warning while it is unset.
 */
export interface DesktopSigningSecrets {
  macos: {
    /** Base64 of the "Developer ID Application" certificate + private key (.p12). */
    certificateP12: string;
    certificatePassword: string;
    /** App Store Connect API key for notarytool: the `.p8` file contents, its key id and issuer id. */
    apiKeyP8: string;
    apiKeyId: string;
    apiIssuer: string;
  };
  windows: {
    /** Base64 of the Authenticode code-signing certificate + private key (.pfx). */
    certificatePfx: string;
    certificatePassword: string;
  };
  linux: {
    /** ASCII-armoured GPG secret key that signs packages and repository metadata. */
    gpgPrivateKey: string;
    /** Optional passphrase of that key. */
    gpgPassphrase: string;
  };
}

/** One ForePath publisher identity for every app (Apple Developer ID, Authenticode certificate, GPG key). */
export const FOREPATH_DESKTOP_SIGNING_SECRETS: DesktopSigningSecrets = {
  macos: {
    certificateP12: 'DESKTOP_MACOS_CERTIFICATE_P12',
    certificatePassword: 'DESKTOP_MACOS_CERTIFICATE_PASSWORD',
    apiKeyP8: 'DESKTOP_APPLE_API_KEY_P8',
    apiKeyId: 'DESKTOP_APPLE_API_KEY_ID',
    apiIssuer: 'DESKTOP_APPLE_API_ISSUER',
  },
  windows: {
    certificatePfx: 'DESKTOP_WINDOWS_CERTIFICATE_PFX',
    certificatePassword: 'DESKTOP_WINDOWS_CERTIFICATE_PASSWORD',
  },
  linux: {
    gpgPrivateKey: 'DESKTOP_LINUX_GPG_PRIVATE_KEY',
    gpgPassphrase: 'DESKTOP_LINUX_GPG_PASSPHRASE',
  },
};

export interface DesktopAppConfig {
  /** Key used on the command line (`--app`). */
  app: string;
  /** Release product: names the signed release manifest and the trusted keys (`RELEASE_SIGNING_KEYS.<product>`). */
  product: ReleaseProduct;
  nxProject: string;
  /** Where `nx build` puts the Electron app; Forge writes `out/` below it. */
  distDir: string;
  /** macOS bundle id / Windows app id. */
  appId: string;
  productName: string;
  /** Forge's app name: packaged directory `<executableName>-<platform>-<arch>`, `<executableName>.app`, `.exe`. */
  executableName: string;
  /** deb / rpm package name and the command installed to `/usr/bin`. */
  packageName: string;
  summary: string;
  description: string;
  homepage: string;
  license: string;
  vendor: string;
  maintainer: string;
  /** PNG icon inside `distDir`. */
  icon: string;
  /** Public base URL of the product's download bucket (`releases/<version>/desktop/…`, feeds, repositories). */
  downloadsBaseUrl: string;
  /** Feeds live at `<downloadsBaseUrl>/<updateFeedPath>/<channel>.json`. */
  updateFeedPath: string;
  channels: readonly DesktopUpdateChannel[];
  macos: {
    arches: readonly ('arm64' | 'x64')[];
    /** Hardened-runtime entitlements (repository path). */
    entitlements: string;
  };
  windows: {
    /** RFC 3161 timestamp server for Authenticode signatures. */
    timestampUrl: string;
  };
  linux: {
    /** Runtime dependencies of the rpm (Electron's shared libraries; the deb's come from maker-deb). */
    rpmRequires: readonly string[];
    /** apt `Origin` / `Label`. */
    repoOrigin: string;
    repoLabel: string;
    /** File name of the exported public GPG key at the bucket root. */
    gpgPublicKeyFile: string;
  };
  secrets: DesktopSigningSecrets;
}

export const DESKTOP_APPS: Readonly<Record<string, DesktopAppConfig>> = {
  agenstra: {
    app: 'agenstra',
    product: 'agenstra',
    nxProject: 'agenstra-native-agent-console',
    distDir: 'dist/apps/agenstra/native-agent-console',
    appId: 'io.forepath.agenstra.native-agent-console',
    productName: 'Agenstra Agent Console',
    executableName: 'native-agent-console',
    packageName: 'agenstra',
    summary: 'Agenstra Agent Console',
    description: 'Desktop client of the Agenstra agent console.',
    homepage: 'https://agenstra.com',
    license: 'BUSL-1.1',
    vendor: 'ForePath',
    maintainer: 'ForePath <hi@forepath.io>',
    icon: 'icon.png',
    downloadsBaseUrl: 'https://downloads.agenstra.com',
    updateFeedPath: 'updates/desktop',
    channels: ['stable', 'beta'],
    macos: {
      arches: ['arm64', 'x64'],
      entitlements: 'apps/agenstra/native-agent-console/entitlements.mac.plist',
    },
    windows: { timestampUrl: 'http://timestamp.digicert.com' },
    linux: {
      rpmRequires: ['gtk3', 'libnotify', 'nss', 'libXScrnSaver', 'libXtst', 'xdg-utils', 'at-spi2-core', 'libuuid'],
      repoOrigin: 'ForePath',
      repoLabel: 'Agenstra',
      gpgPublicKeyFile: 'forepath-desktop.asc',
    },
    secrets: FOREPATH_DESKTOP_SIGNING_SECRETS,
  },
};

export function desktopApp(name: string | undefined): DesktopAppConfig {
  const app = name ? DESKTOP_APPS[name] : undefined;

  if (!app) throw new Error(`--app must be one of ${Object.keys(DESKTOP_APPS).join(', ')}`);

  return app;
}

export function updateFeedUrl(app: DesktopAppConfig, channel: DesktopUpdateChannel): string {
  return `${app.downloadsBaseUrl}/${app.updateFeedPath}/${channel}.json`;
}

/** Forge's packaged app directory for a platform / arch. */
export function packagedDir(app: DesktopAppConfig, platform: 'darwin' | 'linux' | 'win32', arch: string): string {
  return `${app.distDir}/out/${app.executableName}-${platform}-${arch}`;
}
