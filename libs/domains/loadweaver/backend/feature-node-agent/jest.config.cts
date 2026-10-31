module.exports = {
  displayName: 'loadweaver-backend-feature-node-agent',
  preset: '../../../../../jest.preset.cjs',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  // Real-kernel lab suites need Docker and run through the `integration-test` / `vm-lab` targets.
  testPathIgnorePatterns: [
    '/node_modules/',
    '\\.integration\\.spec\\.ts$',
    '\\.vm-lab\\.spec\\.ts$',
  ],
  coverageDirectory:
    '../../../../../coverage/libs/domains/loadweaver/backend/feature-node-agent',
};
