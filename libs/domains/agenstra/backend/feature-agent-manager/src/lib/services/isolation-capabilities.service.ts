import { parseGvisorRuntimeArgs } from '@forepath/shared/backend/util-container-runtime';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';

import {
  GVISOR_ISOLATION_LEVELS,
  type GvisorIsolationLevel,
  type GvisorLevelRuntimes,
  gvisorIsolationLevelSwitch,
  ISOLATION_LEVEL_RANK,
  ISOLATION_LEVELS,
  type IsolationLevel,
  IsolationReasonCode,
  isGvisorIsolationLevelEnabled,
  isIsolationProbeSchedulerEnabled,
  resolveGvisorLevelRuntimes,
  resolveIsolationFailureThreshold,
  resolveIsolationProbeImage,
  resolveIsolationProbeIntervalMs,
  resolveIsolationProbeTimeoutMs,
  STANDARD_ISOLATION_RUNTIME,
} from '../constants/container-isolation.constants';
import type { HostIsolationCapabilitiesDto, IsolationLevelCapabilityDto } from '../dto/container-isolation.dto';
import {
  availableIsolationLevels,
  computeIsolationCapabilityRevision,
  isGvisorIsolationLevel,
  strongestAvailableIsolationLevel,
} from '../utils/container-isolation.utils';

import { DockerService, type IsolationProbeResult } from './docker.service';

type CapabilityLevels = HostIsolationCapabilitiesDto['levels'];

/** Operator-facing name of a gVisor level's runtime (used in reasons). */
const GVISOR_LEVEL_LABEL: Readonly<Record<GvisorIsolationLevel, string>> = {
  sandboxed: 'gVisor',
  'sandboxed-kvm': 'gVisor KVM',
};

/**
 * Probes which container isolation levels this agent manager host can actually run.
 *
 * - Standard (`runc`) is the mandatory floor: when its probe fails the host is not runnable.
 * - Sandboxed (gVisor `runsc-systrap`) and sandboxed-kvm (gVisor `runsc-kvm`, KVM platform) each become
 *   `ready` only after their runtime is registered with Docker AND the complete probe (worker image
 *   contract, filesystem, exec, logs, shared egress namespace) passed on it. Presence of the binary or a
 *   daemon.json entry alone is never enough. The levels are probed independently on top of the floor.
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
  private readonly consecutiveRuntimeFailures = new Map<GvisorIsolationLevel, number>();
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

  /** A gVisor environment container started fine: reset the failure streak of its level. */
  recordRuntimeSuccess(level: IsolationLevel): void {
    if (isGvisorIsolationLevel(level)) {
      this.consecutiveRuntimeFailures.set(level, 0);
    }
  }

  /**
   * A gVisor environment container failed to be created/started. After the configured number of
   * consecutive failures of the same level the capabilities are re-probed, so a broken runtime stops
   * being offered. The failed workload is never re-run on another runtime.
   */
  recordRuntimeFailure(level: IsolationLevel): void {
    if (!isGvisorIsolationLevel(level)) {
      return;
    }

    const failures = (this.consecutiveRuntimeFailures.get(level) ?? 0) + 1;

    if (failures >= resolveIsolationFailureThreshold(this.env)) {
      this.consecutiveRuntimeFailures.set(level, 0);
      this.logger.warn(`Repeated ${level} runtime failures: re-probing isolation capabilities`);
      void this.probe().catch(() => undefined);
    } else {
      this.consecutiveRuntimeFailures.set(level, failures);
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
    const pending = (level: IsolationLevel): IsolationLevelCapabilityDto => ({
      rank: ISOLATION_LEVEL_RANK[level],
      runtime: isGvisorIsolationLevel(level)
        ? resolveGvisorLevelRuntimes(level, this.env).runtime
        : STANDARD_ISOLATION_RUNTIME,
      state: 'probe-failed',
      reasonCode: IsolationReasonCode.PROBE_PENDING,
      reason: 'Isolation capabilities have not been probed yet',
    });
    const levels = Object.fromEntries(ISOLATION_LEVELS.map((level) => [level, pending(level)])) as CapabilityLevels;

    return this.finalize(levels, null, { runtimes: {} });
  }

  private async runProbe(): Promise<HostIsolationCapabilitiesDto> {
    const env = this.env;
    // Workers behind an egress guard or on a user-defined agent network need the kernel network stack
    // variant of their gVisor level (Netstack bypasses the guard's netfilter rules and Docker's embedded DNS).
    const guarded = this.egressGuardEnabled(env) || !!env['AGENT_DOCKER_NETWORK']?.trim();
    const image = resolveIsolationProbeImage(env);
    const timeoutMs = resolveIsolationProbeTimeoutMs(env);
    const gvisorRuntimes = Object.fromEntries(
      GVISOR_ISOLATION_LEVELS.map((level) => [level, resolveGvisorLevelRuntimes(level, env)]),
    ) as Record<GvisorIsolationLevel, GvisorLevelRuntimes>;
    const levels = {
      standard: { rank: ISOLATION_LEVEL_RANK.standard, runtime: STANDARD_ISOLATION_RUNTIME, state: 'probe-failed' },
      ...Object.fromEntries(
        GVISOR_ISOLATION_LEVELS.map((level) => [
          level,
          { rank: ISOLATION_LEVEL_RANK[level], runtime: gvisorRuntimes[level].runtime, state: 'unsupported' },
        ]),
      ),
    } as CapabilityLevels;
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

      for (const level of GVISOR_ISOLATION_LEVELS) {
        levels[level] = this.failed(
          { ...levels[level], state: 'unsupported' },
          IsolationReasonCode.DOCKER_UNAVAILABLE,
          'Docker daemon is not reachable',
        );
      }

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
    // existed) and only withhold the gVisor levels, which cannot be verified.
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

    // gVisor levels (optional, each only on top of a healthy floor, probed independently).
    for (const level of GVISOR_ISOLATION_LEVELS) {
      levels[level] = await this.probeGvisorLevel(level, levels[level], {
        runtimes: gvisorRuntimes[level],
        hostInfo,
        guarded,
        probeImageUnavailable,
        standardReady: levels.standard.state === 'ready',
        image,
        timeoutMs,
        allRuntimes: gvisorRuntimes,
      });
    }

    const probeImageId = await this.dockerService.getImageId(image).catch(() => null);

    return this.commit(levels, new Date(), {
      dockerVersion: hostInfo.serverVersion,
      kernelVersion: hostInfo.kernelVersion,
      runtimes: hostInfo.runtimes,
      probeImageId,
    });
  }

  /** Probe chain of one gVisor level (see the class documentation). */
  private async probeGvisorLevel(
    level: GvisorIsolationLevel,
    capability: IsolationLevelCapabilityDto,
    context: {
      runtimes: GvisorLevelRuntimes;
      hostInfo: Awaited<ReturnType<DockerService['getDockerHostInfo']>>;
      guarded: boolean;
      probeImageUnavailable: boolean;
      standardReady: boolean;
      image: string;
      timeoutMs: number;
      allRuntimes: Record<GvisorIsolationLevel, GvisorLevelRuntimes>;
    },
  ): Promise<IsolationLevelCapabilityDto> {
    const { runtimes, hostInfo, guarded } = context;
    const label = GVISOR_LEVEL_LABEL[level];

    if (!isGvisorIsolationLevelEnabled(level, this.env)) {
      return {
        ...capability,
        state: 'disabled-by-admin',
        reasonCode: IsolationReasonCode.DISABLED_BY_ADMIN,
        reason: `The ${level} level is disabled on this agent manager (${gvisorIsolationLevelSwitch(level)}=false)`,
      };
    }

    if (!(runtimes.runtime in hostInfo.runtimes)) {
      return {
        ...capability,
        state: 'unsupported',
        reasonCode: IsolationReasonCode.RUNTIME_NOT_REGISTERED,
        reason: `Docker runtime '${runtimes.runtime}' (${label}) is not registered on this host`,
      };
    }

    if (context.probeImageUnavailable) {
      return this.failed(
        capability,
        IsolationReasonCode.PROBE_IMAGE_UNAVAILABLE,
        `The probe image is unavailable; the ${level} runtime cannot be verified`,
      );
    }

    if (
      guarded &&
      (runtimes.sharedNetnsRuntime === runtimes.runtime || !(runtimes.sharedNetnsRuntime in hostInfo.runtimes))
    ) {
      return {
        ...capability,
        state: 'unsupported',
        reasonCode: IsolationReasonCode.SHARED_NETNS_RUNTIME_NOT_REGISTERED,
        reason: `Docker runtime '${runtimes.sharedNetnsRuntime}' (${label} for workers behind an egress guard or on the agent network) is not registered on this host`,
      };
    }

    const misconfigured = this.misconfiguredRuntime(level, runtimes, hostInfo, guarded, context.allRuntimes);

    if (misconfigured) {
      return this.failed(
        capability,
        IsolationReasonCode.RUNTIME_MISCONFIGURED,
        `Docker runtime '${misconfigured}' is not registered with the expected gVisor platform / network mode for the ${level} level`,
      );
    }

    if (!context.standardReady) {
      return this.failed(
        capability,
        IsolationReasonCode.RUNC_PROBE_FAILED,
        'Skipped: the standard Docker baseline failed',
      );
    }

    const result = await this.dockerService.runIsolationProbe({
      runtime: runtimes.runtime,
      image: context.image,
      timeoutMs: context.timeoutMs,
      sharedNetworkNamespace: guarded,
      sharedNetworkNamespaceRuntime: runtimes.sharedNetnsRuntime,
    });

    return this.applyResult(capability, result, IsolationReasonCode.PROBE_START_FAILED);
  }

  /**
   * Name of a runtime of the level that contradicts the level, or `null`:
   * - the runtime used behind an egress guard / on the agent network must use the namespace's kernel
   *   network stack (`--network=host`) on every gVisor level (Netstack would bypass the guard);
   * - sandboxed-kvm runtimes must run on the KVM platform with the expected network mode and must not
   *   reuse a runtime name of another level (the network mapping would pick the other level's pair).
   * The Netstack runtime of the sandboxed level keeps its name-based check exactly as before. Docker
   * omits `runtimeArgs` for runtimes registered without arguments; only when Docker reports arguments
   * for no runtime at all (older releases) the check falls back to the runtime name.
   */
  private misconfiguredRuntime(
    level: GvisorIsolationLevel,
    runtimes: GvisorLevelRuntimes,
    hostInfo: Awaited<ReturnType<DockerService['getDockerHostInfo']>>,
    guarded: boolean,
    allRuntimes: Record<GvisorIsolationLevel, GvisorLevelRuntimes>,
  ): string | null {
    const args = hostInfo.runtimeArgs ?? {};
    const argsReported = Object.values(args).some((value) => Array.isArray(value) && value.length > 0);
    const registeredAs = (name: string) => {
      const reported = args[name];

      // Shim-registered runtimes (no entry) and Docker releases without runtime arguments: name only.
      if (!(name in args) || (!argsReported && !reported?.length)) {
        return null;
      }

      const parsed = parseGvisorRuntimeArgs(reported ?? []);

      // gVisor's default platform is systrap and its default network stack is Netstack.
      return { platform: parsed.platform ?? 'systrap', hostNetwork: parsed.network === 'host' };
    };

    if (guarded) {
      const sharedNetns = registeredAs(runtimes.sharedNetnsRuntime);

      if (sharedNetns && (!sharedNetns.hostNetwork || (level === 'sandboxed-kvm' && sharedNetns.platform !== 'kvm'))) {
        return runtimes.sharedNetnsRuntime;
      }
    }

    if (level !== 'sandboxed-kvm') {
      return null;
    }

    const otherNames = new Set(
      GVISOR_ISOLATION_LEVELS.filter((other) => other !== level).flatMap((other) => [
        allRuntimes[other].runtime,
        allRuntimes[other].sharedNetnsRuntime,
      ]),
    );

    for (const name of [runtimes.runtime, runtimes.sharedNetnsRuntime]) {
      if (otherNames.has(name)) {
        return name;
      }
    }

    const netstack = registeredAs(runtimes.runtime);

    if (netstack && (netstack.platform !== 'kvm' || netstack.hostNetwork)) {
      return runtimes.runtime;
    }

    return null;
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
      const states = ISOLATION_LEVELS.map(
        (level) =>
          `${level}=${next.levels[level].state}` +
          (level !== 'standard' && next.levels[level].reasonCode ? ` (${next.levels[level].reasonCode})` : ''),
      ).join(', ');

      this.logger.log(`Isolation capabilities: ${states}, recommended=${next.recommendedLevel ?? 'none'}`);
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
