// M7 VM lab (isolation levels, microVMs, full VMs, consoles, QEMU live migration, Agenstra on Loadweaver): real
// Debian 13 VMs with nested KVM. Slow; run through the `vm-lab-m7` target (heavy + VM-lab locks, memory watchdog).
module.exports = {
  displayName: 'loadweaver-backend-feature-node-agent-vm-lab-m7',
  preset: '../../../../../jest.preset.cjs',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  testMatch: ['<rootDir>/src/integration/vm-lab/m7/**/*.vm-lab.spec.ts'],
  globalSetup: '<rootDir>/src/integration/vm-lab/m7/m7.global-setup.ts',
  globalTeardown: '<rootDir>/src/integration/vm-lab/vm-lab.global-teardown.ts',
  testTimeout: 60 * 60 * 1000,
  maxWorkers: 1,
};
