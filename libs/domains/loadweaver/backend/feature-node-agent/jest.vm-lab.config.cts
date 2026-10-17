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
  globalSetup: '<rootDir>/src/integration/vm-lab/vm-lab.global-setup.ts',
  testTimeout: 30 * 60 * 1000,
  maxWorkers: 1,
};
