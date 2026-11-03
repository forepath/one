export default {
  displayName: 'agenstra-native-agent-console',
  preset: '../../../jest.preset.cjs',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js'],
  coverageDirectory: '../../../coverage/apps/agenstra/native-agent-console',
  testMatch: ['**/src/**/*.spec.ts'],
};
