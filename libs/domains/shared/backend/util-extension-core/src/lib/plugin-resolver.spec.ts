import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { PluginResolver } from './plugin-resolver';

function writeFixture(workspaceRoot: string): string {
  const packageRoot = path.join(workspaceRoot, 'libs/domains/demo/backend/provider-fixture');
  fs.mkdirSync(path.join(packageRoot, 'src/lib'), { recursive: true });

  fs.writeFileSync(
    path.join(packageRoot, 'forepath.extension.json'),
    JSON.stringify({
      id: 'fixture',
      kind: 'agent-provider',
      name: 'Fixture',
      description: 'Fixture extension',
    }),
  );

  fs.writeFileSync(
    path.join(packageRoot, 'src/lib/fixture.extension.js'),
    `
class FixtureProvider {
  getType() {
    return 'fixture';
  }
}

class FixtureExtensionModule {}

function createFixtureExtension() {
  return {
    register() {
      return {
        module: FixtureExtensionModule,
        providers: [FixtureProvider],
        exports: [FixtureProvider],
      };
    },
    getInstanceToken() {
      return FixtureProvider;
    },
  };
}

module.exports = { createFixtureExtension };
`,
  );

  fs.writeFileSync(path.join(packageRoot, 'src/index.js'), `module.exports = require('./lib/fixture.extension.js');`);

  const tsconfigPath = path.join(workspaceRoot, 'tsconfig.base.json');
  const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf-8')) as {
    compilerOptions: { paths: Record<string, string[]> };
  };

  tsconfig.compilerOptions.paths['@forepath/demo/backend/provider-fixture'] = [
    'libs/domains/demo/backend/provider-fixture/src/index.js',
  ];
  fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2));

  return '@forepath/demo/backend/provider-fixture';
}

describe('PluginResolver', () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'forepath-resolver-'));
    fs.writeFileSync(
      path.join(workspaceRoot, 'package.json'),
      JSON.stringify({ name: 'fixture-workspace', version: '0.0.0' }),
    );
    fs.writeFileSync(
      path.join(workspaceRoot, 'tsconfig.base.json'),
      JSON.stringify({ compilerOptions: { paths: {} } }, null, 2),
    );
  });

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it('rejects kind mismatch before loading extension code', () => {
    const importPath = writeFixture(workspaceRoot);
    const resolver = new PluginResolver({ workspaceRoot, expectedKind: 'payment-processor' });

    expect(() => resolver.resolveSync(importPath)).toThrow(/kind/);
  });

  it('loads monorepo extension using default entrypoint', () => {
    const importPath = writeFixture(workspaceRoot);
    const resolver = new PluginResolver({ workspaceRoot, expectedKind: 'agent-provider' });
    const loaded = resolver.resolveSync(importPath);

    expect(loaded.manifest.id).toBe('fixture');
    expect(loaded.manifest.version).toBe('0.0.0');
    expect(typeof loaded.extension.register).toBe('function');
  });

  it('uses manifest entrypoint override when provided', () => {
    const importPath = writeFixture(workspaceRoot);
    const packageRoot = path.join(workspaceRoot, 'libs/domains/demo/backend/provider-fixture');

    fs.writeFileSync(
      path.join(packageRoot, 'forepath.extension.json'),
      JSON.stringify({
        id: 'fixture',
        kind: 'agent-provider',
        name: 'Fixture',
        description: 'Fixture extension',
        entrypoint: './src/lib/fixture.extension.js',
      }),
    );

    const resolver = new PluginResolver({ workspaceRoot, expectedKind: 'agent-provider' });
    const loaded = resolver.resolveSync(importPath);

    expect(loaded.extension.register()).toBeDefined();
  });
});
