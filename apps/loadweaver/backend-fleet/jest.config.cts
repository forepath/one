module.exports = {
  displayName: 'loadweaver-backend-fleet',
  preset: '../../../jest.preset.cjs',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  // Integration suites need Docker and run through the `integration-test` target.
  testPathIgnorePatterns: ['/node_modules/', '\\.integration\\.spec\\.ts$'],
  coverageDirectory: '../../../coverage/apps/loadweaver/backend-fleet',
};
