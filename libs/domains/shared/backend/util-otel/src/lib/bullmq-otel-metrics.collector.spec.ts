import { BullMqOtelMetricsCollector } from './bullmq-otel-metrics.collector';

const getJobCounts = jest.fn();
const close = jest.fn();

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation((name: string) => ({
    name,
    getJobCounts,
    close,
  })),
}));

jest.mock('@forepath/shared/backend/util-queue', () => ({
  readRedisConnectionConfig: () => ({
    host: 'localhost',
    port: 6379,
    db: 0,
    keyPrefix: 'test',
  }),
  toBullMqConnection: () => ({ host: 'localhost', port: 6379, db: 0 }),
}));

const closeConnection = jest.fn().mockResolvedValue(undefined);

jest.mock('./otel-redis-connection', () => ({
  readOtelRedisConnectionConfig: () => ({ host: 'localhost', port: 6379, db: 0, keyPrefix: 'test' }),
  createOtelBullMqConnection: () => ({ connection: { host: 'localhost', port: 6379, db: 0 }, close: closeConnection }),
}));

const addCallback = jest.fn();
const createObservableGauge = jest.fn(() => ({ addCallback }));

jest.mock('./otel-sdk', () => ({
  getMeter: () => ({
    createObservableGauge,
  }),
}));

describe('BullMqOtelMetricsCollector', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getJobCounts.mockResolvedValue({
      waiting: 1,
      active: 2,
      delayed: 0,
      paused: 0,
      completed: 10,
      failed: 3,
    });
    close.mockResolvedValue(undefined);
  });

  it('does nothing when queueNames is empty', () => {
    const collector = new BullMqOtelMetricsCollector({ applicationId: 'test', queueNames: [] });

    collector.onModuleInit();

    expect(createObservableGauge).not.toHaveBeenCalled();
  });

  it('registers gauges and polls job counts for configured queues', async () => {
    const collector = new BullMqOtelMetricsCollector({
      applicationId: 'test',
      queueNames: ['billing'],
    });

    collector.onModuleInit();

    expect(createObservableGauge).toHaveBeenCalled();

    await new Promise((resolve) => setImmediate(resolve));

    expect(getJobCounts).toHaveBeenCalled();

    await collector.onModuleDestroy();

    expect(close).toHaveBeenCalled();
    expect(closeConnection).toHaveBeenCalled();
  });
});
