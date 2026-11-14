const setGauge = jest.fn();
const isOtelEffectivelyEnabled = jest.fn(() => true);
const resolveOtelRuntimeConfig = jest.fn(() => ({ enabled: true }));

jest.mock('@forepath/shared/backend/util-otel', () => ({
  isOtelEffectivelyEnabled,
  resolveOtelRuntimeConfig,
  setGauge,
}));

import { Logger } from '@nestjs/common';

import type { UpdatesModuleOptions } from '../interfaces/updates-module.options';
import type { UpdatesFullState } from '../interfaces/updates.interfaces';

import { UpdatesMetricsCollector } from './updates-metrics.collector';
import type { UpdatesQueryService } from './updates-query.service';

describe('UpdatesMetricsCollector', () => {
  const options: UpdatesModuleOptions = {
    applicationId: 'agenstra',
    productScope: 'agenstra',
    serviceName: 'agent-controller',
    controllerPath: 'admin/updates',
    queueName: 'controller',
    assertAdmin: jest.fn(),
    resolveScopeKey: () => 'default',
  };
  const fullState: UpdatesFullState = {
    installedVersion: '2.21.0',
    latestVersion: 'v2.22.0',
    updateState: 'update_available',
    lastCheckAt: '2026-08-01T12:00:00.000Z',
    lastCheckStatus: 'success',
    instanceCount: 2,
    outdatedInstanceCount: 1,
    release: null,
    scopedChangelog: { product: [], shared: [] },
    instances: [
      {
        instanceId: 'agent-controller:api:host-a',
        serviceName: 'agent-controller',
        role: 'api',
        hostname: 'host-a',
        installedVersion: '2.21.0',
        updateState: 'update_available',
        lastHeartbeatAt: '2026-08-01T12:00:00.000Z',
        dependencies: {
          redis: 'healthy',
          queue: 'healthy',
          database: 'healthy',
          opensearch: 'healthy',
        },
      },
      {
        instanceId: 'agent-controller:worker:host-b',
        serviceName: 'agent-controller',
        role: 'worker',
        hostname: 'host-b',
        installedVersion: '2.22.0',
        updateState: 'up_to_date',
        lastHeartbeatAt: '2026-08-01T12:00:00.000Z',
        dependencies: {
          redis: 'healthy',
          queue: 'healthy',
          database: 'healthy',
          opensearch: 'healthy',
        },
      },
    ],
  };
  let updatesQuery: { getFullState: jest.Mock };
  let collector: UpdatesMetricsCollector;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    isOtelEffectivelyEnabled.mockReturnValue(true);
    resolveOtelRuntimeConfig.mockReturnValue({ enabled: true });
    updatesQuery = {
      getFullState: jest.fn().mockResolvedValue(fullState),
    };
    collector = new UpdatesMetricsCollector(updatesQuery as unknown as UpdatesQueryService, options);
  });

  afterEach(() => {
    collector.onModuleDestroy();
    jest.useRealTimers();
  });

  it('does not poll when OpenTelemetry is disabled', () => {
    isOtelEffectivelyEnabled.mockReturnValue(false);

    collector.onModuleInit();

    expect(updatesQuery.getFullState).not.toHaveBeenCalled();
    expect(setGauge).not.toHaveBeenCalled();
  });

  it('publishes update status gauges when OpenTelemetry is enabled', async () => {
    collector.onModuleInit();
    await Promise.resolve();

    expect(resolveOtelRuntimeConfig).toHaveBeenCalledWith(process.env, 'agent-controller');
    expect(updatesQuery.getFullState).toHaveBeenCalledTimes(1);

    expect(setGauge).toHaveBeenCalledWith(
      'forepath.updates',
      'updates.info',
      1,
      expect.objectContaining({
        application_id: 'agenstra',
        service_name: 'agent-controller',
        installed_version: '2.21.0',
        latest_version: 'v2.22.0',
        update_state: 'update_available',
        last_check_status: 'success',
      }),
    );
    expect(setGauge).toHaveBeenCalledWith('forepath.updates', 'updates.update_available', 1, {
      application_id: 'agenstra',
      service_name: 'agent-controller',
    });
    expect(setGauge).toHaveBeenCalledWith('forepath.updates', 'updates.instance_count', 2, {
      application_id: 'agenstra',
      service_name: 'agent-controller',
    });
    expect(setGauge).toHaveBeenCalledWith('forepath.updates', 'updates.outdated_instance_count', 1, {
      application_id: 'agenstra',
      service_name: 'agent-controller',
    });
    expect(setGauge).toHaveBeenCalledWith(
      'forepath.updates',
      'updates.last_check_timestamp_seconds',
      Math.floor(Date.parse('2026-08-01T12:00:00.000Z') / 1000),
      {
        application_id: 'agenstra',
        service_name: 'agent-controller',
      },
    );
    expect(setGauge).toHaveBeenCalledWith(
      'forepath.updates',
      'updates.instance_outdated',
      1,
      expect.objectContaining({
        instance_id: 'agent-controller:api:host-a',
        role: 'api',
        update_state: 'update_available',
      }),
    );
    expect(setGauge).toHaveBeenCalledWith(
      'forepath.updates',
      'updates.instance_outdated',
      0,
      expect.objectContaining({
        instance_id: 'agent-controller:worker:host-b',
        role: 'worker',
        update_state: 'up_to_date',
      }),
    );
  });

  it('re-polls on the interval', async () => {
    collector.onModuleInit();
    await Promise.resolve();
    expect(updatesQuery.getFullState).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(60_000);
    await Promise.resolve();

    expect(updatesQuery.getFullState).toHaveBeenCalledTimes(2);
  });

  it('logs and continues when query fails', async () => {
    updatesQuery.getFullState.mockRejectedValueOnce(new Error('redis down'));
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await collector.collectMetrics();

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('redis down'));
    expect(setGauge).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
