import {
  MICROVM_MIGRATION_LABEL,
  MICROVM_QEMU_VERSION_LABEL,
  MICROVM_VIRTIOFSD_VERSION_LABEL,
} from '@forepath/shared/backend/util-microvm-bridge';

/**
 * Live migration support of this node's microVM launcher (M7 W10b), from the launcher image's labels: the launcher
 * modes that can send / receive a QEMU live migration, and the QEMU / virtiofsd versions. Generic microVMs migrate
 * live only between nodes whose launcher has the `generic` mode with QEMU >= 10.0 (vhost-user-fs `migration=internal`)
 * and virtiofsd >= 1.13 (`--migration-mode=find-paths`), the combination spike S7 validates; reported as
 * `capabilities.microvmMigration`.
 */
export interface MicrovmMigrationSupport {
  /** Generic microVMs can live-migrate through this launcher. */
  generic: boolean;
  modes: string[];
  qemu?: string;
  virtiofsd?: string;
}

export const MIN_QEMU_VERSION: readonly [number, number] = [10, 0];
export const MIN_VIRTIOFSD_VERSION: readonly [number, number] = [1, 13];

/** Upstream `major.minor` of a (Debian) package version: `1:10.0.13+ds-0+deb13u1` → [10, 0]. */
export function packageVersion(version: string | undefined): [number, number] | null {
  const match = /^(?:\d+:)?(\d+)\.(\d+)/.exec(version?.trim() ?? '');

  return match ? [Number(match[1]), Number(match[2])] : null;
}

function atLeast(version: [number, number] | null, minimum: readonly [number, number]): boolean {
  return !!version && (version[0] > minimum[0] || (version[0] === minimum[0] && version[1] >= minimum[1]));
}

export function microvmMigrationSupport(labels: Record<string, string> | null | undefined): MicrovmMigrationSupport {
  const modes = (labels?.[MICROVM_MIGRATION_LABEL] ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter((m) => /^[a-z]{1,16}$/.test(m));
  const qemu = labels?.[MICROVM_QEMU_VERSION_LABEL]?.slice(0, 64);
  const virtiofsd = labels?.[MICROVM_VIRTIOFSD_VERSION_LABEL]?.slice(0, 64);

  return {
    generic:
      modes.includes('generic') &&
      atLeast(packageVersion(qemu), MIN_QEMU_VERSION) &&
      atLeast(packageVersion(virtiofsd), MIN_VIRTIOFSD_VERSION),
    modes,
    ...(qemu ? { qemu } : {}),
    ...(virtiofsd ? { virtiofsd } : {}),
  };
}

/**
 * Whether a bundled image's own launcher migrates live (M7 F5): its labels (inherited from the shared launcher it is
 * built on) list the `bundled` mode — Agenstra's `launch` with `AGENSTRA_MICROVM_MIGRATION=1` and an incoming mode —
 * with QEMU / virtiofsd versions that migrate virtio-fs state. Older bundled images run as before (no migration mode).
 */
export function bundledMigrationSupported(labels: Record<string, string> | null | undefined): boolean {
  const support = microvmMigrationSupport(labels);

  return (
    support.modes.includes('bundled') &&
    atLeast(packageVersion(support.qemu), MIN_QEMU_VERSION) &&
    atLeast(packageVersion(support.virtiofsd), MIN_VIRTIOFSD_VERSION)
  );
}

/** `docker image inspect --format '{{json .Config.Labels}}'` output → labels (empty when unreadable). */
export function parseImageLabels(stdout: string): Record<string, string> {
  try {
    const value = JSON.parse(stdout.trim() || 'null') as unknown;

    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'),
    );
  } catch {
    return {};
  }
}
