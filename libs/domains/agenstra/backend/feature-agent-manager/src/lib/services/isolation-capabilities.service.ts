import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';

import {
  ISOLATION_LEVEL_RANK,
  type IsolationLevel,
  IsolationReasonCode,
  isIsolationProbeSchedulerEnabled,
  isSandboxedIsolationEnabled,
  resolveIsolationFailureThreshold,
  resolveIsolationProbeImage,
  resolveIsolationProbeIntervalMs,
  resolveIsolationProbeTimeoutMs,
  resolveSandboxedIsolationRuntime,
  resolveSandboxedSharedNetnsIsolationRuntime,
  STANDARD_ISOLATION_RUNTIME,
} from '../constants/container-isolation.constants';
import type { HostIsolationCapabilitiesDto, IsolationLevelCapabilityDto } from '../dto/container-isolation.dto';
import {
  availableIsolationLevels,
  computeIsolationCapabilityRevision,
  strongestAvailableIsolationLevel,
} from '../utils/container-isolation.utils';

import { DockerService, type IsolationProbeResult } from './docker.service';

type CapabilityLevels = HostIsolationCapabilitiesDto['levels'];

/**
 * Probes which container isolation levels this agent manager host can actually run.
 *
 * - Standard (`runc`) is the mandatory floor: when its probe fails the host is not runnable.
 * - Sandboxed (gVisor `runsc-systrap`) becomes `ready` only after the runtime is registered with
 *   Docker AND the complete probe (worker image contract, filesystem, exec, logs, shared egress
 *   namespace) passed. Presence of the binary or a daemon.json entry alone is never enough.
 *
 * Probes run on startup, periodically (with jitter), on demand, and after repeated runtime
 * failures. Concurrent probe requests share one in-flight probe.
 */
@Injectable()
export class IsolationCapabilitiesService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(IsolationCapabilitiesService.name);
  private capabilities: HostIsolationCapabilitiesDto;
  private inFlight?: Promise<HostIsolationCapabilitiesDto>;
  private timer?: NodeJS.Timeout;
  private consecutiveSandboxFailures = 0;
  static readonly ON_DEMAND_MIN_AGE_MS = 30_000;

  constructor(private readonly dockerService: DockerService) {
    this.capabilities = this.buildInitialCapabilities();
  }

  protected get env(): NodeJS.ProcessEnv {
    return process.env;
  }

  onApplicationBootstrap(): void {
    void this.dockerService
      .removeStaleIsolationProbes()
      .catch(() => 0)
      .then(() => this.probe())
      .catch((error: unknown) => this.logger.warn(`Initial isolation probe failed: ${(error as Error).message}`));

    if (isIsolationProbeSchedulerEnabled(this.env)) {
      this.scheduleNextProbe();
    }
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  /** Current capability record (from the last completed probe). */
  getCapabilities(): HostIsolationCapabilitiesDto {
    return { ...this.capabilities, probing: this.inFlight !== undefined };
  }

  /**
   * Capabilities to validate an environment creation against. Waits for the first probe after a
   * manager start, and re-probes when the standard floor is not ready (a transient failure such as
   * an unreachable registry must not keep the host unusable until the next scheduled probe).
   */
  async getCapabilitiesForCreation(): Promise<HostIsolationCapabilitiesDto> {
    if (this.capabilities.probedAt === null || this.capabilities.levels.standard.state !== 'ready') {
      return this.probe();
    }

    return this.getCapabilities();
  }

  /**
   * On-demand probe (API): joins a running probe and reuses results younger than
   * {@link IsolationCapabilitiesService.ON_DEMAND_MIN_AGE_MS} so the endpoint cannot be used to
   * keep the host busy with probe containers.
   */
  async requestProbe(): Promise<HostIsolationCapabilitiesDto> {
    const probedAt = this.capabilities.probedAt ? Date.parse(this.capabilities.probedAt) : NaN;

    if (
      !this.inFlight &&
      Number.isFinite(probedAt) &&
      Date.now() - probedAt < IsolationCapabilitiesService.ON_DEMAND_MIN_AGE_MS
    ) {
      return this.getCapabilities();
    }

    return this.probe();
  }

  /** Run (or join) a full probe of every isolation level. */
  probe(): Promise<HostIsolationCapabilitiesDto> {
    if (!this.inFlight) {
      this.inFlight = this.runProbe().finally(() => {
        this.inFlight = undefined;
      });
    }

    return this.inFlight;
  }

  /** A sandboxed environment container started fine: reset the failure streak. */
  recordRuntimeSuccess(level: IsolationLevel): void {
    if (level === 'sandboxed') {
      this.consecutiveSandboxFailures = 0;
    }
  }

  /**
   * A sandboxed environment container failed to be created/started. After the configured number of
   * consecutive failures the capability is re-probed, so a broken runtime stops being offered.
   * The failed workload is never re-run on another runtime.
   */
  recordRuntimeFailure(level: IsolationLevel): void {
    if (level !== 'sandboxed') {
      return;
    }

    this.consecutiveSandboxFailures += 1;

    if (this.consecutiveSandboxFailures >= resolveIsolationFailureThreshold(this.env)) {
      this.consecutiveSandboxFailures = 0;
      this.logger.warn('Repeated sandboxed runtime failures: re-probing isolation capabilities');
      void this.probe().catch(() => undefined);
    }
  }

  private scheduleNextProbe(): void {
    const base = resolveIsolationProbeIntervalMs(this.env);
    // ±10% jitter avoids synchronized probes across many hosts.
    const delay = Math.round(base * (0.9 + Math.random() * 0.2));

    this.timer = setTimeout(() => {
      void this.probe()
        .catch(() => undefined)
        .finally(() => this.scheduleNextProbe());
    }, delay);
    this.timer.unref?.();
  }

  private buildInitialCapabilities(): HostIsolationCapabilitiesDto {
    const levels: CapabilityLevels = {
      standard: {
        rank: ISOLATION_LEVEL_RANK.standard,
        runtime: STANDARD_ISOLATION_RUNTIME,
        state: 'probe-failed',
        reasonCode: IsolationReasonCode.PROBE_PENDING,
        reason: 'Isolation capabilities have not been probed yet',
      },
      sandboxed: {
        rank: ISOLATION_LEVEL_RANK.sandboxed,
        runtime: resolveSandboxedIsolationRuntime(this.env),
        state: 'probe-failed',
        reasonCode: IsolationReasonCode.PROBE_PENDING,
        reason: 'Isolation capabilities have not been probed yet',
      },
    };

    return this.finalize(levels, null, { runtimes: {} });
  }

  private async runProbe(): Promise<HostIsolationCapabilitiesDto> {
    const env = this.env;
    const sandboxRuntime = resolveSandboxedIsolationRuntime(env);
    // Workers behind an egress guard share its network namespace and need the guard-compatible runtime.
    // Workers behind an egress guard or on a user-defined agent network need gVisor's kernel network
    // stack variant (Netstack bypasses the guard's netfilter rules and Docker's embedded DNS).
    const guarded = this.egressGuardEnabled(env) || !!env['AGENT_DOCKER_NETWORK']?.trim();
    const sharedNetnsRuntime = resolveSandboxedSharedNetnsIsolationRuntime(env);
    const image = resolveIsolationProbeImage(env);
    const timeoutMs = resolveIsolationProbeTimeoutMs(env);
    const levels: CapabilityLevels = {
      standard: { rank: ISOLATION_LEVEL_RANK.standard, runtime: STANDARD_ISOLATION_RUNTIME, state: 'probe-failed' },
      sandboxed: { rank: ISOLATION_LEVEL_RANK.sandboxed, runtime: sandboxRuntime, state: 'unsupported' },
    };
    let hostInfo: Awaited<ReturnType<DockerService['getDockerHostInfo']>> | null = null;

    try {
      hostInfo = await this.dockerService.getDockerHostInfo();
    } catch (error) {
      this.logger.error(`Docker daemon unavailable for isolation probe: ${(error as Error).message}`);
      levels.standard = this.failed(
        levels.standard,
        IsolationReasonCode.DOCKER_UNAVAILABLE,
        'Docker daemon is not reachable',
      );
      levels.sandboxed = this.failed(
        { ...levels.sandboxed, state: 'unsupported' },
        IsolationReasonCode.DOCKER_UNAVAILABLE,
        'Docker daemon is not reachable',
      );

      return this.commit(levels, null, { runtimes: {} });
    }

    // Standard floor: Docker's default runtime (normally runc), exactly what environments used before
    // isolation levels existed.
    const standardRuntime = hostInfo.defaultRuntime || STANDARD_ISOLATION_RUNTIME;

    levels.standard = { ...levels.standard, runtime: standardRuntime };
    const standardResult = await this.dockerService.runIsolationProbe({
      expectedRuntime: standardRuntime,
      image,
      timeoutMs,
    });

    levels.standard = this.applyResult(levels.standard, standardResult, IsolationReasonCode.RUNC_PROBE_FAILED);

    // An unavailable probe image (e.g. registry outage, custom AGENT_ISOLATION_PROBE_IMAGE) says nothing
    // about the Docker/runc baseline itself: keep the standard floor usable (as before isolation levels
    // existed) and only withhold the sandboxed level, which cannot be verified.
    const probeImageUnavailable =
      !standardResult.ok &&
      (standardResult as Extract<typeof standardResult, { ok: false }>).reasonCode ===
        IsolationReasonCode.PROBE_IMAGE_UNAVAILABLE;

    if (probeImageUnavailable) {
      levels.standard = {
        ...levels.standard,
        state: 'ready',
        reasonCode: IsolationReasonCode.PROBE_IMAGE_UNAVAILABLE,
        reason: 'The probe image is unavailable; the Docker baseline is reachable but could not be fully probed',
      };
    }

    // Sandboxed (optional, only on top of a healthy floor).
    if (!isSandboxedIsolationEnabled(env)) {
      levels.sandboxed = {
        ...levels.sandboxed,
        state: 'disabled-by-admin',
        reasonCode: IsolationReasonCode.DISABLED_BY_ADMIN,
        reason: 'The sandboxed level is disabled on this agent manager (AGENT_ISOLATION_SANDBOX_ENABLED=false)',
      };
    } else if (!(sandboxRuntime in hostInfo.runtimes)) {
      levels.sandboxed = {
        ...levels.sandboxed,
        state: 'unsupported',
        reasonCode: IsolationReasonCode.RUNTIME_NOT_REGISTERED,
        reason: `Docker runtime '${sandboxRuntime}' (gVisor) is not registered on this host`,
      };
    } else if (probeImageUnavailable) {
      levels.sandboxed = this.failed(
        levels.sandboxed,
        IsolationReasonCode.PROBE_IMAGE_UNAVAILABLE,
        'The probe image is unavailable; the sandboxed runtime cannot be verified',
      );
    } else if (guarded && (sharedNetnsRuntime === sandboxRuntime || !(sharedNetnsRuntime in hostInfo.runtimes))) {
      levels.sandboxed = {
        ...levels.sandboxed,
        state: 'unsupported',
        reasonCode: IsolationReasonCode.SHARED_NETNS_RUNTIME_NOT_REGISTERED,
        reason: `Docker runtime '${sharedNetnsRuntime}' (gVisor for workers behind an egress guard or on the agent network) is not registered on this host`,
      };
    } else if (levels.standard.state !== 'ready') {
      levels.sandboxed = this.failed(
        levels.sandboxed,
        IsolationReasonCode.RUNC_PROBE_FAILED,
        'Skipped: the standard Docker baseline failed',
      );
    } else {
      const sandboxResult = await this.dockerService.runIsolationProbe({
        runtime: sandboxRuntime,
        image,
        timeoutMs,
        sharedNetworkNamespace: guarded,
        sharedNetworkNamespaceRuntime: sharedNetnsRuntime,
      });

      levels.sandboxed = this.applyResult(levels.sandboxed, sandboxResult, IsolationReasonCode.PROBE_START_FAILED);
    }

    const probeImageId = await this.dockerService.getImageId(image).catch(() => null);

    return this.commit(levels, new Date(), {
      dockerVersion: hostInfo.serverVersion,
      kernelVersion: hostInfo.kernelVersion,
      runtimes: hostInfo.runtimes,
      probeImageId,
    });
  }

  private egressGuardEnabled(env: NodeJS.ProcessEnv): boolean {
    return (env['AGENT_EGRESS_GUARD_ENABLED'] ?? 'true').trim().toLowerCase() !== 'false';
  }

  private applyResult(
    level: IsolationLevelCapabilityDto,
    result: IsolationProbeResult,
    fallbackReason: IsolationReasonCode,
  ): IsolationLevelCapabilityDto {
    if (result.ok) {
      return { rank: level.rank, runtime: level.runtime, state: 'ready' };
    }

    const failure = result as Extract<IsolationProbeResult, { ok: false }>;

    return this.failed(level, failure.reasonCode ?? fallbackReason, failure.reason);
  }

  private failed(level: IsolationLevelCapabilityDto, reasonCode: string, reason: string): IsolationLevelCapabilityDto {
    return { rank: level.rank, runtime: level.runtime, state: 'probe-failed', reasonCode, reason };
  }

  private commit(
    levels: CapabilityLevels,
    probedAt: Date | null,
    facts: Omit<Parameters<typeof computeIsolationCapabilityRevision>[0], 'levels'>,
  ): HostIsolationCapabilitiesDto {
    const previous = this.capabilities;
    const next = this.finalize(levels, probedAt, facts);

    this.capabilities = next;

    if (previous.revision !== next.revision) {
      this.logger.log(
        `Isolation capabilities: standard=${next.levels.standard.state}, sandboxed=${next.levels.sandboxed.state}` +
          (next.levels.sandboxed.reasonCode ? ` (${next.levels.sandboxed.reasonCode})` : '') +
          `, recommended=${next.recommendedLevel ?? 'none'}`,
      );
    }

    return { ...next, probing: false };
  }

  private finalize(
    levels: CapabilityLevels,
    probedAt: Date | null,
    facts: Omit<Parameters<typeof computeIsolationCapabilityRevision>[0], 'levels'>,
  ): HostIsolationCapabilitiesDto {
    return {
      revision: computeIsolationCapabilityRevision({ ...facts, levels }),
      probedAt: probedAt ? probedAt.toISOString() : null,
      probing: false,
      levels,
      recommendedLevel: strongestAvailableIsolationLevel(levels),
      availableLevels: levels.standard.state === 'ready' ? availableIsolationLevels(levels) : [],
    };
  }
}
