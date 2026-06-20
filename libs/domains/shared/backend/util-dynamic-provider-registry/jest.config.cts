module.exports = {
  displayName: 'shared-backend-util-dynamic-provider-registry',
  preset: '../../../../../jest.preset.cjs',
  testEnvironment: 'node',
  globalSetup: '<rootDir>/src/test-fixtures/global-setup.cjs',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  transformIgnorePatterns: ['/node_modules/', '<rootDir>/src/test-fixtures/'],
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory:
    '../../../../../coverage/libs/domains/shared/backend/util-dynamic-provider-registry',
};
