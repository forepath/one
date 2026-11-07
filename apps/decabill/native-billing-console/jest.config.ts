export default {
  displayName: 'decabill-native-billing-console',
  preset: '../../../jest.preset.cjs',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js'],
  coverageDirectory: '../../../coverage/apps/decabill/native-billing-console',
  testMatch: ['**/src/**/*.spec.ts'],
};
