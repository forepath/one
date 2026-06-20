const {
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  symlinkSync,
} = require('node:fs');
const { dirname, join } = require('node:path');

const fixturesRoot = join(__dirname, '.');
const appRoot = join(fixturesRoot, 'app-root-fixture');
const pluginRoot = join(fixturesRoot, 'plugin-root');
const providerFixture = join(fixturesRoot, 'runtime-provider-fixture');
const mountedFixture = join(fixturesRoot, 'mounted-plugin-fixture');
const linkedModulePath = join(
  appRoot,
  'node_modules/@forepath/test/runtime-provider-fixture',
);
const mountedPluginCopy = join(pluginRoot, 'mounted-plugin-fixture');

mkdirSync(dirname(linkedModulePath), { recursive: true });
mkdirSync(pluginRoot, { recursive: true });

if (!existsSync(linkedModulePath)) {
  symlinkSync(providerFixture, linkedModulePath, 'junction');
}

if (existsSync(mountedPluginCopy)) {
  rmSync(mountedPluginCopy, { recursive: true, force: true });
}

cpSync(mountedFixture, mountedPluginCopy, { recursive: true, force: true });
