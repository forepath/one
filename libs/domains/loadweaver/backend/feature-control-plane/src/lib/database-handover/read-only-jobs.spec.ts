import { CertificatesService } from '../acme/certificates.service';
import { AuditService } from '../audit/audit.service';
import { AutoscalerService } from '../autoscaling/autoscaler.service';
import { BackupCommandsService } from '../backups/backup-commands.service';
import { BackupSchedulerService } from '../backups/backup-scheduler.service';
import { DrRecoveryService } from '../backups/platform/dr-recovery.service';
import { PlatformBackupsService } from '../backups/platform/platform-backups.service';
import { PlatformCopyService } from '../backups/platform/platform-copy.service';
import { PlatformCutoverService } from '../backups/platform/platform-cutover.service';
import { DnsFailoverControllerService } from '../dns/dns-failover-controller.service';
import { DnsReconcilerService } from '../dns/dns-reconciler.service';
import { DnssecService } from '../dns/dnssec.service';
import { DraftRetentionService } from '../drafts/draft-retention.service';
import { GitBotService } from '../git/git-bot.service';
import { GitSyncService } from '../git/git-sync.service';
import { ImportControllerService } from '../import/import-controller.service';
import { LiveBroker } from '../live/live-broker';
import { LiveRecordsService } from '../live/live-records.service';
import { MetricsStore } from '../metrics/metrics.store';
import { ApplyOperationService } from '../plans/apply-operation.service';
import { RemoteAccessService } from '../remote-access/remote-access.service';
import { CronControllerService } from '../services/cron-controller.service';
import { MigrationSessionService } from '../services/migration-session.service';
import { ObjectStoreControllerService } from '../services/object-store-controller.service';
import { PostgresCertificateRenewalService } from '../services/postgres-certificate-renewal.service';
import { PublicAddressControllerService } from '../services/public-address-controller.service';
import { ReplicaDrainService } from '../services/replica-drain.service';
import { VirtualMachinesService } from '../services/virtual-machines.service';
import { VmImageImportService } from '../services/vm-image-import.service';
import { WorkloadControllerService } from '../services/workload-controller.service';
import { SiemForwarderService } from '../siem/siem-forwarder.service';
import { RolloutControllerService } from '../updates/rollout-controller.service';
import { UpdatePolicyService } from '../updates/update-policy.service';
import { UsageService } from '../usage/usage.service';
import { databaseTarget } from './database-target.runtime';

/**
 * 3.43 (user, 2026-10-31): while the control plane is read-only, write-only background jobs skip their ticks through
 * `writesPaused` instead of failing every time ("cannot execute INSERT … in a read-only transaction"). The services are
 * built without their dependencies (`Object.create`); only what the guarded entry point touches is stubbed.
 */

type Instance = Record<string, unknown>;

function bare(cls: { prototype: object }, fields: Instance = {}): Instance {
  return Object.assign(Object.create(cls.prototype) as Instance, {
    logger: { log: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
    ...fields,
  });
}

const tick = () => jest.fn(async () => null);

afterEach(() => {
  databaseTarget.reset();
  jest.useRealTimers();
});

describe('safeTick-driven controllers skip their tick while writes are paused', () => {
  const cases: [string, { prototype: object }, Instance][] = [
    ['VM image imports', VmImageImportService, {}],
    ['Cron controller', CronControllerService, {}],
    ['Certificates', CertificatesService, {}],
    [
      'Backups',
      BackupSchedulerService,
      { leases: { ifFree: async (_k: string, fn: () => Promise<void>) => await fn() } },
    ],
    ['Platform backups', PlatformBackupsService, {}],
    ['Cut-over', PlatformCutoverService, {}],
    ['Disaster recovery', DrRecoveryService, {}],
    ['Workload controller', WorkloadControllerService, {}],
    ['Object store', ObjectStoreControllerService, {}],
    ['Public addresses', PublicAddressControllerService, {}],
    ['Replica drain', ReplicaDrainService, {}],
    ['DNS', DnsReconcilerService, {}],
    ['DNS failover', DnsFailoverControllerService, {}],
    ['DNSSEC', DnssecService, {}],
    ['Import controller', ImportControllerService, {}],
    ['Autoscaler', AutoscalerService, {}],
  ];

  it.each(cases)('%s', async (job, cls, fields) => {
    const service = bare(cls, { tick: tick(), ...fields });
    const safeTick = () => (service['safeTick'] as () => Promise<void>).call(service);
    const logger = service['logger'] as { log: jest.Mock };

    databaseTarget.setFallback(true);
    await safeTick();
    await safeTick();
    expect(service['tick']).not.toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledTimes(1);
    expect(logger.log.mock.calls[0][0]).toMatch(new RegExp(`^${job}: paused`));

    databaseTarget.setFallback(false);
    await safeTick();
    expect(service['tick']).toHaveBeenCalledTimes(1);
    expect(logger.log).toHaveBeenLastCalledWith(`${job}: resumed, the cluster database takes writes again`);
  });
});

describe('interval jobs skip their run while writes are paused', () => {
  const env = { ...process.env };

  afterEach(() => (process.env = { ...env }));

  const cases: [string, () => Instance, string[]][] = [
    ['VM commands', () => bare(VirtualMachinesService, { dispatch: tick() }), ['dispatch']],
    ['Backup commands', () => bare(BackupCommandsService, { sendDue: tick() }), ['sendDue']],
    ['SIEM forwarding', () => bare(SiemForwarderService, { tick: tick() }), ['tick']],
    ['Audit mirror', () => bare(AuditService, { tick: tick(), opensearch: { isEnabled: () => true } }), ['tick']],
    ['Rollouts', () => bare(RolloutControllerService, { tick: tick() }), ['tick']],
    ['Update policies', () => bare(UpdatePolicyService, { tick: tick() }), ['tick']],
    ['Remote access', () => bare(RemoteAccessService, { tick: tick() }), ['tick']],
    ['Apply sweep', () => bare(ApplyOperationService, { sweep: tick() }), ['sweep']],
    ['Draft retention', () => bare(DraftRetentionService, { tick: tick() }), ['tick']],
    ['Migration sessions', () => bare(MigrationSessionService, { sendDue: tick() }), ['sendDue']],
    [
      'Git bot',
      () =>
        bare(GitBotService, {
          reconcile: tick(),
          sync: { registerBot: jest.fn() },
          events: { onPlanStatus: jest.fn() },
          chains: new Map(),
        }),
      ['reconcile'],
    ],
    [
      'Recording retention / orphaned live sessions',
      () => bare(LiveRecordsService, { sweep: tick(), closeOrphans: tick() }),
      ['sweep', 'closeOrphans'],
    ],
    [
      'Usage',
      () => bare(UsageService, { sample: tick(), rollup: tick(), retention: tick(), timers: [] }),
      ['sample', 'rollup', 'retention'],
    ],
    [
      'Metrics',
      () => bare(MetricsStore, { setup: tick(), rollup: tick(), retention: tick(), timers: [] }),
      ['rollup', 'retention'],
    ],
    [
      'Postgres certificate renewal',
      () => bare(PostgresCertificateRenewalService, { tick: tick(), timers: [] }),
      ['tick'],
    ],
  ];

  it.each(cases)('%s', (_job, make, methods) => {
    jest.useFakeTimers();
    delete process.env['LOADWEAVER_POSTGRES_CERTIFICATE_RENEWAL'];

    const service = make();
    const calls = () => methods.map((m) => (service[m] as jest.Mock).mock.calls.length);

    (service['onApplicationBootstrap'] as () => void).call(service);
    databaseTarget.setFallback(true);
    jest.runOnlyPendingTimers();
    expect(calls()).toEqual(methods.map(() => 0));

    databaseTarget.setFallback(false);
    jest.runOnlyPendingTimers();
    expect(calls().every((n) => n >= 1)).toBe(true);
    void (service['onModuleDestroy'] as () => unknown).call(service);
  });

  it('Live relay cleanup: no DELETE on lw_live_relay while paused (3.43 live test)', async () => {
    jest.useFakeTimers();

    const query = jest.fn(async () => []);
    const broker = new LiveBroker(
      {
        query,
        createQueryRunner: () => ({
          connect: async () => undefined,
          query: async () => undefined,
          release: async () => undefined,
          databaseConnection: { on: () => undefined },
        }),
      } as never,
      { get: () => undefined } as never,
    );
    const deletes = () =>
      (query.mock.calls as unknown as [string][]).filter(([sql]) => sql.startsWith('DELETE FROM lw_live_relay')).length;

    await broker.onApplicationBootstrap();
    databaseTarget.setFallback(true);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(deletes()).toBe(0);

    databaseTarget.setFallback(false);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(deletes()).toBe(1);
    await broker.onModuleDestroy();
  });

  it('Git sync and platform copy: a kick does nothing while paused', () => {
    process.env['LOADWEAVER_PLATFORM_BACKUPS'] = 'on';

    const git = bare(GitSyncService, { tick: tick(), stopped: false, current: null, again: false });
    const copy = bare(PlatformCopyService, { run: tick() });

    databaseTarget.setFallback(true);
    (git['kick'] as () => void).call(git);
    (copy['kick'] as () => void).call(copy);
    expect(git['tick']).not.toHaveBeenCalled();
    expect(copy['run']).not.toHaveBeenCalled();

    databaseTarget.setFallback(false);
    (git['kick'] as () => void).call(git);
    (copy['kick'] as () => void).call(copy);
    expect(git['tick']).toHaveBeenCalledTimes(1);
    expect(copy['run']).toHaveBeenCalledTimes(1);
  });
});
