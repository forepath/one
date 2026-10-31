module.exports = {
  displayName: 'loadweaver-backend-control-plane-integration',
  preset: '../../../jest.preset.cjs',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  testMatch: ['<rootDir>/src/**/*.integration.spec.ts'],
  globalSetup: '<rootDir>/src/integration/postgres.global-setup.ts',
  globalTeardown: '<rootDir>/src/integration/postgres.global-teardown.ts',
  setupFiles: ['<rootDir>/src/integration/integration-env.ts'],
  setupFilesAfterEnv: ['<rootDir>/src/integration/integration-isolation.ts'],
  testTimeout: 120_000,
  maxWorkers: 1,
  coverageDirectory:
    '../../../coverage/apps/loadweaver/backend-control-plane-integration',
};
