// VM lab (M6): real Debian 13 VMs under QEMU/KVM in containers. Slow; run explicitly via the `vm-lab` target.
module.exports = {
  displayName: 'loadweaver-backend-feature-node-agent-vm-lab',
  preset: '../../../../../jest.preset.cjs',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  testMatch: ['<rootDir>/src/**/*.vm-lab.spec.ts'],
  // M7 specs and spikes have their own targets (vm-lab-m7, vm-lab-spikes) and bundles.
  testPathIgnorePatterns: ['/node_modules/', '/vm-lab/m7/', '/vm-lab/spikes/'],
  globalSetup: '<rootDir>/src/integration/vm-lab/vm-lab.global-setup.ts',
  globalTeardown: '<rootDir>/src/integration/vm-lab/vm-lab.global-teardown.ts',
  testTimeout: 30 * 60 * 1000,
  maxWorkers: 1,
};
