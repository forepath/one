module.exports = {
  displayName: 'loadweaver-backend-fleet-integration',
  preset: '../../../jest.preset.cjs',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  testMatch: ['<rootDir>/src/**/*.integration.spec.ts'],
  setupFiles: ['<rootDir>/src/integration/integration-env.ts'],
  testTimeout: 180_000,
  maxWorkers: 1,
  coverageDirectory:
    '../../../coverage/apps/loadweaver/backend-fleet-integration',
};
