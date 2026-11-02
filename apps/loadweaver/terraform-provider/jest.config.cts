module.exports = {
  displayName: 'loadweaver-terraform-provider',
  preset: '../../../jest.preset.cjs',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
    '^.+\\.proto$':
      '<rootDir>/../../../libs/domains/loadweaver/backend/util-terraform-protocol/jest.proto-transform.cjs',
  },
  // scripts/*.cjs are plain CommonJS (shared with the packaging script): loaded as is.
  transformIgnorePatterns: ['/node_modules/', '/scripts/[^/]+\\.cjs$'],
  moduleFileExtensions: ['ts', 'js', 'html', 'proto'],
  coverageDirectory: '../../../coverage/apps/loadweaver/terraform-provider',
  // The e2e spec (real terraform CLI, downloaded) runs only with its own target / LOADWEAVER_TF_E2E=1.
  testPathIgnorePatterns: process.env.LOADWEAVER_TF_E2E
    ? []
    : ['\\.e2e\\.spec\\.ts$'],
};
