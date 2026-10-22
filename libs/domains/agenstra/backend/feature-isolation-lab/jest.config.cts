module.exports = {
  displayName: 'agenstra-backend-feature-isolation-lab',
  preset: '../../../../../jest.preset.cjs',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  // Real VM scenarios only run through the explicit `isolation-lab` target (jest.isolation-lab.config.cts).
  testPathIgnorePatterns: ['/node_modules/', '\\.isolation-lab\\.spec\\.ts$'],
  coverageDirectory:
    '../../../../../coverage/libs/domains/agenstra/backend/feature-isolation-lab',
};
