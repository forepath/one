export default {
  displayName: 'agenstra-frontend-feature-agent-console',
  preset: '../../../../../jest.preset.cjs',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  coverageDirectory: '../../../../../coverage/libs/domains/agenstra/frontend/feature-agent-console',
  transform: {
    '^.+\\.(ts|mjs|js|html)$': [
      'jest-preset-angular',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
        stringifyContentPathRegex: '\\.(html|svg)$',
      },
    ],
  },
  transformIgnorePatterns: ['node_modules/(?!.*\\.mjs$)'],
  // The graph worker factory uses `new URL(…, import.meta.url)` (bundled by the app builder), which CommonJS tests
  // cannot parse: tests run the graph jobs inline instead.
  moduleNameMapper: {
    '^\\./graph-worker\\.factory$': '<rootDir>/jest/graph-worker.factory.ts',
  },
  snapshotSerializers: [
    'jest-preset-angular/build/serializers/no-ng-attributes',
    'jest-preset-angular/build/serializers/ng-snapshot',
    'jest-preset-angular/build/serializers/html-comment',
  ],
};
