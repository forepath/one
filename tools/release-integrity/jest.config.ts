export default {
  displayName: 'release-integrity',
  preset: '../../jest.preset.cjs',
  testEnvironment: 'node',
  coverageDirectory: '../../coverage/tools/release-integrity',
  testMatch: ['**/src/**/*.spec.ts', '**/signing/**/*.spec.ts'],
};
