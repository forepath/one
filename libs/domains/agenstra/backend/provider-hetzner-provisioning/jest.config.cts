module.exports = {
  displayName: 'agenstra-backend-provider-hetzner-provisioning',
  preset: '../../../../../jest.preset.cjs',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory:
    '../../../../../coverage/libs/domains/agenstra/backend/provider-hetzner-provisioning',
};
