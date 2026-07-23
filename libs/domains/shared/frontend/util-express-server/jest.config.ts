export default {
  displayName: 'shared-frontend-util-express-server',
  preset: '../../../../../jest.preset.cjs',
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'mjs'],
  coverageDirectory: '../../../../../coverage/libs/domains/shared/frontend/util-express-server',
};
