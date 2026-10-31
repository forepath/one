import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';

import { controlPlaneAuthGuards, controlPlaneAuthImports } from './auth-wiring';

/** Stands in for `TypeOrmModule.forRoot` — `forFeature` repositories resolve against it. */
const fakeDataSource = {
  entityMetadatas: [],
  options: { type: 'postgres' },
  getRepository: () => ({}),
};

@Global()
@Module({
  providers: [{ provide: getDataSourceToken(), useValue: fakeDataSource }],
  exports: [getDataSourceToken()],
})
class FakeDataSourceModule {}

describe('control-plane auth wiring', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  async function compile(authMethod: string) {
    process.env.AUTHENTICATION_METHOD = authMethod;
    process.env.JWT_SECRET = 'unit-test-secret';
    process.env.KEYCLOAK_SERVER_URL = 'http://keycloak.invalid';
    process.env.KEYCLOAK_AUTH_SERVER_URL = 'http://keycloak.invalid';
    process.env.KEYCLOAK_REALM = 'loadweaver';
    process.env.KEYCLOAK_CLIENT_ID = 'loadweaver';
    process.env.KEYCLOAK_CLIENT_SECRET = 'secret';

    const moduleRef = await Test.createTestingModule({
      imports: [FakeDataSourceModule, ...controlPlaneAuthImports(authMethod)],
      providers: controlPlaneAuthGuards(authMethod),
    }).compile();

    await moduleRef.close();
  }

  it('compiles for AUTHENTICATION_METHOD=keycloak', async () => {
    await expect(compile('keycloak')).resolves.toBeUndefined();
  });

  it('compiles for AUTHENTICATION_METHOD=users', async () => {
    await expect(compile('users')).resolves.toBeUndefined();
  });

  it('compiles for AUTHENTICATION_METHOD=api-key', async () => {
    process.env.STATIC_API_KEY = 'k';
    await expect(compile('api-key')).resolves.toBeUndefined();
  });
});
