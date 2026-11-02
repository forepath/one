/**
 * E2E isolation lab (real QEMU/KVM VMs inside Docker containers). Slow and explicit only:
 * `nx run agenstra-backend-feature-isolation-lab:isolation-lab`.
 */
module.exports = {
  displayName: 'agenstra-backend-feature-isolation-lab (lab)',
  preset: '../../../../../jest.preset.cjs',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  testMatch: ['<rootDir>/src/integration/**/*.isolation-lab.spec.ts'],
  // ESM-only packages reached through library barrels but never executed by the lab.
  moduleNameMapper: {
    '^archiver$': '<rootDir>/src/integration/harness/stubs/esm-only.stub.cjs',
  },
  // Heavy + VM-lab locks once per run (each spec file has its own environment; see harness/global-setup.ts).
  globalSetup: '<rootDir>/src/integration/harness/global-setup.ts',
  globalTeardown: '<rootDir>/src/integration/harness/global-teardown.ts',
  testTimeout: 30 * 60_000,
  coverageDirectory:
    '../../../../../coverage/libs/domains/agenstra/backend/feature-isolation-lab-lab',
};
