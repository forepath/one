module.exports = {
  displayName: 'loadweaver-backend-util-terraform-protocol',
  preset: '../../../../../jest.preset.cjs',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
    '^.+\\.proto$': '<rootDir>/jest.proto-transform.cjs',
  },
  moduleFileExtensions: ['ts', 'js', 'html', 'proto'],
  coverageDirectory:
    '../../../../../coverage/libs/domains/loadweaver/backend/util-terraform-protocol',
};
