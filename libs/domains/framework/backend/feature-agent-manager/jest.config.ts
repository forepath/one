export default {
  displayName: 'framework-backend-feature-agent-manager',
  preset: '../../../../../jest.preset.cjs',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleNameMapper: {
    '^@agentclientprotocol/sdk$': '<rootDir>/src/test-utils/acp-sdk.mock.ts',
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../../../../coverage/libs/domains/framework/backend/feature-agent-manager',
};
