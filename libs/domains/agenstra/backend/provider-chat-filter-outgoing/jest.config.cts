module.exports = {
  displayName: 'agenstra-backend-provider-chat-filter-outgoing',
  preset: '../../../../../jest.preset.cjs',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory:
    '../../../../../coverage/libs/domains/agenstra/backend/provider-chat-filter-outgoing',
};
