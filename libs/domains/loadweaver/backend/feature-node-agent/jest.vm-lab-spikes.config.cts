// M7 spikes S1–S10 ("Risks and spikes" of the M7 design): PASS / FAIL + measurements per spike. Run through the
// `vm-lab-spikes` target (heavy + VM-lab locks, memory watchdog); results in $VM_LAB_RESULTS_DIR (default <tmp>/vm-lab/results).
module.exports = {
  displayName: 'loadweaver-backend-feature-node-agent-vm-lab-spikes',
  preset: '../../../../../jest.preset.cjs',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  testMatch: [
    '<rootDir>/src/integration/vm-lab/spikes/**/*.spike.vm-lab.spec.ts',
  ],
  globalSetup: '<rootDir>/src/integration/vm-lab/m7/m7.global-setup.ts',
  globalTeardown: '<rootDir>/src/integration/vm-lab/vm-lab.global-teardown.ts',
  testTimeout: 60 * 60 * 1000,
  maxWorkers: 1,
};
