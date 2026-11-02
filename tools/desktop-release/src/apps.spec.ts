import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { RELEASE_SIGNING_KEYS } from '@forepath/shared/shared/util-release-keys';

import { DESKTOP_APPS, desktopApp, packagedDir, updateFeedUrl } from './apps';

const root = join(__dirname, '..', '..', '..');

describe('desktop app registry', () => {
  it.each(Object.values(DESKTOP_APPS))('$app is complete and consistent', (app) => {
    expect(desktopApp(app.app)).toBe(app);
    expect(existsSync(join(root, app.macos.entitlements))).toBe(true);
    expect(existsSync(join(root, app.distDir.replace(/^dist\//, ''), 'project.json'))).toBe(true);
    expect(RELEASE_SIGNING_KEYS[app.product].length).toBeGreaterThan(0);
    expect(app.downloadsBaseUrl).toMatch(/^https:\/\/[^/]+$/);
    expect(app.packageName).toMatch(/^[a-z][a-z0-9-]+$/);

    const names = [
      ...Object.values(app.secrets.macos),
      ...Object.values(app.secrets.windows),
      ...Object.values(app.secrets.linux),
    ];

    expect(new Set(names).size).toBe(names.length);
    names.forEach((n) => expect(n).toMatch(/^[A-Z][A-Z0-9_]+$/));
  });

  it('builds feed URLs and Forge paths', () => {
    const app = desktopApp('agenstra');

    expect(updateFeedUrl(app, 'beta')).toBe('https://downloads.agenstra.com/updates/desktop/beta.json');
    expect(packagedDir(app, 'linux', 'x64')).toBe(
      'dist/apps/agenstra/native-agent-console/out/native-agent-console-linux-x64',
    );
    expect(() => desktopApp('nope')).toThrow(/--app/);
    expect(() => desktopApp(undefined)).toThrow();
  });
});
