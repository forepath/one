module.exports = {
  displayName: 'loadweaver-shared-util-secrets',
  preset: '../../../../../jest.preset.cjs',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  // The age / SOPS interoperability lab needs Docker and runs through the `integration-test` target.
  testPathIgnorePatterns: ['/node_modules/', '\\.integration\\.spec\\.ts$'],
  coverageDirectory:
    '../../../../../coverage/libs/domains/loadweaver/shared/util-secrets',
};
