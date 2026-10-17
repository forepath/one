module.exports = {
  displayName: 'loadweaver-backend-control-plane-integration',
  preset: '../../../jest.preset.cjs',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  // agenstra-runtime.integration drives the control plane with Agenstra's agent manager client; the manager's barrel
  // pulls in the ESM-only ACP SDK, which that path never uses (same stub as the manager's own unit tests).
  moduleNameMapper: {
    '^@agentclientprotocol/sdk$':
      '<rootDir>/../../../libs/domains/agenstra/backend/feature-agent-manager/src/test-utils/acp-sdk.mock.ts',
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
