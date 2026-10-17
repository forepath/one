import { PORT_ENV } from './postgres.container';

// Configure the app before any module reads its environment.
Object.assign(process.env, {
  NODE_ENV: 'test',
  DB_HOST: '127.0.0.1',
  DB_PORT: process.env[PORT_ENV] ?? '5432',
  DB_USERNAME: 'postgres',
  DB_PASSWORD: 'postgres',
  DB_DATABASE: 'loadweaver',
  AUTHENTICATION_METHOD: 'api-key',
  STATIC_API_KEY: 'integration-test-api-key',
  ENCRYPTION_KEY: 'MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=',
  LOADWEAVER_CLUSTER_ID: 'it',
  LOADWEAVER_GRPC_HOSTNAMES: 'localhost',
  LOADWEAVER_GRPC_PORT: String(17000 + (process.pid % 2000)),
  LOADWEAVER_GRPC_ENDPOINTS: `localhost:${17000 + (process.pid % 2000)}`,
  RATE_LIMIT_ENABLED: 'false',
  // The test drives the workload controller tick by tick.
  LOADWEAVER_WORKLOAD_CONTROLLER: 'off',
  LOADWEAVER_OBJECT_STORE: 'off',
});
