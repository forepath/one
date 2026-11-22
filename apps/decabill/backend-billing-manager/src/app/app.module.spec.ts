import {
  AgenstraControllerContributorModule,
  AgenstraManagerContributorModule,
  BillingModule,
  ContainerManagerContributorModule,
  DecabillBillingContributorModule,
  DigitalOceanContributorModule,
  HetznerContributorModule,
} from '@forepath/decabill/backend';

import { BillingQueueModule } from '../queue/billing-queue.module';

import { AppModule } from './app.module';

function findBillingDynamicModule(
  imports: unknown[] | undefined,
): { module: unknown; imports?: unknown[] } | undefined {
  return (imports ?? []).find(
    (entry): entry is { module: unknown; imports?: unknown[] } =>
      typeof entry === 'object' &&
      entry !== null &&
      'module' in entry &&
      (entry as { module: unknown }).module === BillingModule,
  );
}

describe('AppModule.register', () => {
  const originalCacheClient = process.env.CACHE_CLIENT;

  beforeAll(() => {
    // Registering the queue module creates its connection; the default GLIDE driver loads a native client that
    // keeps Jest from exiting. ioredis only yields connection options and opens nothing until a queue starts.
    process.env.CACHE_CLIENT = 'ioredis';
  });

  afterAll(() => {
    if (originalCacheClient === undefined) {
      delete process.env.CACHE_CLIENT;
    } else {
      process.env.CACHE_CLIENT = originalCacheClient;
    }
  });

  afterEach(() => {
    BillingModule.withContributors([]);
  });

  it('includes first-party provider, Container Manager, and integrated stack modules for API and worker registrations', () => {
    const app = AppModule.register([]);
    const billing = findBillingDynamicModule(app.imports);

    expect(billing?.imports).toEqual(
      expect.arrayContaining([
        HetznerContributorModule,
        DigitalOceanContributorModule,
        ContainerManagerContributorModule,
        AgenstraControllerContributorModule,
        AgenstraManagerContributorModule,
        DecabillBillingContributorModule,
      ]),
    );

    const queue = BillingQueueModule.register();
    const queueBilling = findBillingDynamicModule(queue.imports);

    expect(queueBilling?.imports).toEqual(
      expect.arrayContaining([
        HetznerContributorModule,
        DigitalOceanContributorModule,
        ContainerManagerContributorModule,
        AgenstraControllerContributorModule,
        AgenstraManagerContributorModule,
        DecabillBillingContributorModule,
      ]),
    );
  });
});
