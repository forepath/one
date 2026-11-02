module.exports = {
  displayName: 'loadweaver-backend-feature-terraform-provider',
  preset: '../../../../../jest.preset.cjs',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
    '^.+\\.proto$':
      '<rootDir>/../util-terraform-protocol/jest.proto-transform.cjs',
  },
  moduleFileExtensions: ['ts', 'js', 'html', 'proto'],
  coverageDirectory:
    '../../../../../coverage/libs/domains/loadweaver/backend/feature-terraform-provider',
};
