module.exports = {
  displayName: 'loadweaver-backend-feature-node-agent-integration',
  preset: '../../../../../jest.preset.cjs',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  testMatch: ['<rootDir>/src/**/*.integration.spec.ts'],
  globalSetup: '<rootDir>/src/integration/lab.global-setup.ts',
  testTimeout: 180_000,
  maxWorkers: 1,
};
