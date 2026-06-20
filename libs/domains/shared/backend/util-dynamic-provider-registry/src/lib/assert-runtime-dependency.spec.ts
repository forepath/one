import { join } from 'node:path';

import {
  assertAllowlistedSpecifier,
  assertRuntimeDependency,
  RuntimeDependencyError,
  SpecifierAllowlistError,
} from './assert-runtime-dependency';

const runtimeFixtureAppRoot = join(__dirname, '../test-fixtures/app-root-fixture');

describe('assertRuntimeDependency', () => {
  it('passes when specifier resolves from fixture app root', () => {
    expect(() =>
      assertRuntimeDependency('@forepath/test/runtime-provider-fixture', {
        appRoot: runtimeFixtureAppRoot,
        envKey: 'DYNAMIC_TEST',
        allowlistPrefixes: ['@forepath/'],
      }),
    ).not.toThrow();
  });

  it('fails when specifier is not in app runtime dependency graph', () => {
    expect(() =>
      assertRuntimeDependency('@forepath/missing/runtime-only-tsconfig', {
        appRoot: runtimeFixtureAppRoot,
        envKey: 'DYNAMIC_TEST',
        allowlistPrefixes: ['@forepath/'],
      }),
    ).toThrow(RuntimeDependencyError);
  });

  it('rejects non-allowlisted specifiers', () => {
    expect(() => assertAllowlistedSpecifier('@evil/pkg')).toThrow(SpecifierAllowlistError);
  });
});
