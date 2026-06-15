// Support cross-building (e.g. Windows on Linux via Wine)
const fs = require('fs');
const path = require('path');

const buildPlatform = process.env.ELECTRON_FORGE_PLATFORM || process.platform;
const isLinux = buildPlatform === 'linux';
const isWindows = buildPlatform === 'win32';
const isMac = buildPlatform === 'darwin';

/** Icon base path without extension (electron-packager adds .ico / .icns / .png per OS). */
function resolveIconBasePath() {
  const candidates = [path.join(__dirname, 'icon'), path.join(__dirname, 'public', 'assets', 'images', 'icon')];
  for (const base of candidates) {
    if (fs.existsSync(`${base}.ico`) || fs.existsSync(`${base}.icns`) || fs.existsSync(`${base}.png`)) {
      return base;
    }
  }
  return candidates[1];
}

module.exports = {
  packagerConfig: {
    asar: true,
    icon: resolveIconBasePath(),
    extraResource: ['./server'],
    ignore: [/^\/\.git/, /^\/node_modules\/\.cache/, /^\/\.vscode/, /^\/\.idea/, /^\/\.DS_Store/],
    prune: false,
  },
  makers: [
    ...(isWindows
      ? [
          {
            name: '@electron-forge/maker-zip',
            platforms: ['win32'],
          },
        ]
      : []),
    ...(isMac
      ? [
          {
            name: '@electron-forge/maker-zip',
            platforms: ['darwin'],
          },
        ]
      : []),
    ...(isLinux
      ? [
          {
            name: '@electron-forge/maker-zip',
            platforms: ['linux'],
          },
          {
            name: '@electron-forge/maker-deb',
            config: { name: 'agenstra' },
            platforms: ['linux'],
          },
        ]
      : []),
  ],
  plugins: [],
};
