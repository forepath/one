export default {
  displayName: 'desktop-release',
  preset: '../../jest.preset.cjs',
  testEnvironment: 'node',
  coverageDirectory: '../../coverage/tools/desktop-release',
  testMatch: ['**/src/**/*.spec.ts'],
};
