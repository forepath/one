import type { AptSource } from '@forepath/loadweaver/shared/util-agent-protocol';

/**
 * Host updates from the cluster-local apt source (3.26): the agent writes its own apt configuration (sources,
 * pins, lists) below its state directory and runs apt with it, so the host's own sources and lists stay untouched
 * and only the frozen snapshot is used. apt verifies the snapshot's `InRelease` with the distribution keyring and
 * every package against the index. `Check-Valid-Until` is off: the snapshot is frozen on purpose (taken at plan
 * time, served by the control plane), so an index older than its validity window is expected and not a replay.
 */

const SAFE = /^[A-Za-z0-9._+~:-]+$/;
const SAFE_PATH = /^\/[A-Za-z0-9._/-]+$/;

function check(value: string, what: string, pattern = SAFE): string {
  if (!pattern.test(value)) throw new Error(`unsafe ${what}: ${JSON.stringify(value)}`);

  return value;
}

export interface AptPaths {
  /** Directory of the agent's apt configuration (`<state>/apt`). */
  dir: string;
}

/** `-o` options pointing apt at the agent's configuration only. */
export function aptOptions(paths: AptPaths): string[] {
  const dir = check(paths.dir, 'apt directory', SAFE_PATH);

  return [
    `Dir::Etc::sourcelist=${dir}/sources.list`,
    'Dir::Etc::sourceparts=-',
    `Dir::Etc::preferences=${dir}/preferences`,
    'Dir::Etc::preferencesparts=-',
    `Dir::State::Lists=${dir}/lists`,
    'APT::Get::List-Cleanup=0',
    'Acquire::Languages=none',
    'Acquire::Check-Valid-Until=false',
    'Acquire::Retries=3',
    'Dpkg::Options::=--force-confdef',
    'Dpkg::Options::=--force-confold',
    'Dpkg::Use-Pty=0',
  ].flatMap((o) => ['-o', o]);
}

/** The agent's `sources.list` for a snapshot: one line per source and suite. */
export function aptSourcesList(controlPlaneUrl: string, aptBase: string, sources: readonly AptSource[]): string {
  const base = `${controlPlaneUrl.replace(/\/+$/, '')}${aptBase}`;

  if (!/^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?(\/[A-Za-z0-9._-]+)*$/.test(base)) throw new Error('unsafe apt base URL');

  return (
    sources
      .flatMap((s) =>
        s.suites.map(
          (suite) =>
            `deb [signed-by=${check(s.keyring, 'keyring', SAFE_PATH)}] ${base}/${check(s.name, 'source')} ${check(suite, 'suite')} ${s.components.map((c) => check(c, 'component')).join(' ')}`,
        ),
      )
      .join('\n') + '\n'
  );
}

/** apt preferences holding the release's pinned packages at their tested versions (also as a downgrade). */
export function aptPreferences(pins: Record<string, string>): string {
  return Object.entries(pins)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(
      ([pkg, version]) =>
        `Package: ${check(pkg, 'package')}\nPin: version ${check(version, 'version')}\nPin-Priority: 1001\n`,
    )
    .join('\n');
}

export interface HostScriptInput {
  apt: AptPaths;
  /** Upgrade every installed package to the snapshot (security updates). */
  upgrade: boolean;
  /** Pinned packages to install / hold at their versions (only those present on the host, plus required ones). */
  install: Record<string, string>;
  /**
   * Required host packages (util-release `REQUIRED_HOST_PACKAGES`, `name` or `name=version` when the release pins it):
   * the ones not installed on the node are installed from the snapshot (nodes installed before a package became
   * required); installed ones stay untouched. A package missing from the snapshot fails the update with its reason.
   */
  requiredPackages?: readonly string[];
  /** bird2 changes: BIRD stops with graceful restart first (peers keep its routes, 3.26). */
  birdGracefulRestart: boolean;
  /**
   * gVisor: the downloaded release tarball and the generated install script (util-container-runtime). `kvm: false`:
   * the node spec opts out of KVM (3.1) — no KVM preparation, no KVM runtimes (removed if registered).
   */
  gvisor?: { release: string; tarball: string; script: string; kvm?: boolean };
  /**
   * KVM modules follow the kernel (3.1, Ubuntu): `linux-modules-extra-<k>` at exactly the kernel package's version, from
   * the snapshot, for the running kernel and the one the next boot runs — set when the node uses KVM (or its CPU
   * could) and isn't opted out. A missing package is reported, never fatal (the probe after the reboot decides).
   */
  kvmModules?: boolean;
  /**
   * DRBD 9 module for the newest installed kernel: prebuilt per kernel, or built from the source tarball with the
   * release's pre-generated compat patches for that kernel (`compat`: kernel → entry files + their `compat.h` MD5; one
   * per distinct `compat.h`, DRBD picks the one matching the node's headers) — offline,
   * SPAAS disabled; a kernel with neither fails the update before anything changes (3.26, air-gapped).
   */
  drbd?: {
    version: string;
    prebuilt: Record<string, string>;
    source?: string;
    compat?: Record<string, { file: string; md5: string }[]>;
    /** Refuse unsigned modules when Secure Boot is on. */
    signed: boolean;
    /**
     * Online cluster (not air-gapped, decided by the control plane): a kernel without a prebuilt module or compat
     * patch builds from source with LINBIT's SPAAS instead of being refused — checked reachable before anything
     * changes. Without it the build is offline only (`SPAAS=false`).
     */
    spaas?: boolean;
  };
  /** Written with `ok` or `failed <line>` when the script ends (the agent may have restarted meanwhile). */
  resultFile: string;
}

/** LINBIT's SPAAS (DRBD's `gen_compat_patch.sh` talks to it when a kernel's compat patch isn't cached). */
export const SPAAS_HELLO = 'https://spaas.drbd.io/api/v1/hello';

const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

/**
 * The host update script run as a transient systemd unit (outside the agent's sandbox, so it survives agent
 * restarts): packages from the snapshot, gVisor, the DRBD module for the kernel the next boot runs. It never reboots;
 * the control plane orders that separately once the node is drained.
 */
export function hostUpdateScript(input: HostScriptInput): string {
  const apt = ['apt-get', ...aptOptions(input.apt)].map(quote).join(' ');
  const install = Object.entries(input.install)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([pkg, version]) => quote(`${check(pkg, 'package')}=${check(version, 'version')}`))
    .join(' ');
  const result = quote(check(input.resultFile, 'result file', SAFE_PATH));
  const lines = [
    '#!/bin/bash',
    '# Loadweaver host update (3.26): generated by the node agent, run as a transient systemd unit.',
    'set -euo pipefail',
    `trap 'echo "failed line $LINENO" > ${result}' ERR`,
    // A failure with its reason in the result (the agent reports it as the action's error).
    `lw_fail() { trap - ERR; echo "failed: $*" > ${result}; echo "$*" >&2; exit 1; }`,
    'export DEBIAN_FRONTEND=noninteractive',
    `mkdir -p ${quote(input.apt.dir + '/lists/partial')}`,
    `${apt} update`,
  ];
  const drbdVersion = input.drbd ? check(input.drbd.version, 'DRBD version') : '';
  const prebuilt = Object.entries(input.drbd?.prebuilt ?? {}).map(([kernel, file]) => [check(kernel, 'kernel'), file]);
  const compat = input.drbd?.source
    ? Object.entries(input.drbd.compat ?? {})
        .filter(([, entries]) => entries.length > 0)
        .map(
          ([kernel, entries]) =>
            [
              check(kernel, 'kernel'),
              entries.map((e) => quote(e.file)).join(' '),
              entries.map((e) => check(e.md5, 'MD5', /^[0-9a-f]{32}$/)).join(' '),
            ] as const,
        )
    : [];

  const spaas = !!input.drbd?.spaas && !!input.drbd.source;

  if (input.drbd && input.upgrade) {
    const covered = [...new Set([...prebuilt.map(([k]) => k), ...compat.map(([k]) => k)])].sort();

    lines.push(
      ...(spaas
        ? [
            '# Every kernel the upgrade brings needs DRBD 9: a prebuilt module or the pre-generated compat patch from the',
            "# release, else (online cluster) LINBIT's SPAAS for the build — reachable, checked before anything changes.",
          ]
        : [
            '# Every kernel the upgrade brings needs DRBD 9 installable offline: a prebuilt module or the pre-generated compat',
            "# patch for it ships with the release (nodes don't reach LINBIT's SPAAS) — checked before anything changes.",
          ]),
      String.raw`for k in $(${apt} -s dist-upgrade | sed -nE 's/^Inst linux-image-(unsigned-)?([0-9][^ ]*) .*/\2/p'); do`,
      '  case "$k" in',
      ...(covered.length ? [`    ${covered.map(quote).join('|')}) ;;`] : []),
      spaas
        ? `    *) curl -fsS --max-time 30 -o /dev/null ${SPAAS_HELLO} || lw_fail "DRBD ${drbdVersion}: the release ships neither a prebuilt module nor a compat patch for kernel $k and LINBIT's SPAAS is unreachable (the upgrade would install it); nothing was changed" ;;`
        : `    *) lw_fail "DRBD ${drbdVersion}: the release ships neither a prebuilt module nor a compat patch for kernel $k (the upgrade would install it; DRBD builds offline); nothing was changed" ;;`,
      '  esac',
      'done',
    );
  }

  if (input.birdGracefulRestart)
    lines.push(
      '# BIRD leaves with graceful restart: peers keep its routes until it is back (graceful restart is configured).',
      'if systemctl is-active --quiet bird; then birdc graceful restart >/dev/null 2>&1 || true; fi',
    );

  if (input.upgrade) lines.push(`${apt} -y dist-upgrade`);

  if (install) lines.push(`${apt} -y --allow-downgrades --no-install-recommends install ${install}`);

  if (input.birdGracefulRestart) lines.push('systemctl start bird || true');

  const required = (input.requiredPackages ?? []).map((spec) => {
    const [pkg, version] = spec.split('=', 2);

    return quote(
      version === undefined ? check(pkg, 'package') : `${check(pkg, 'package')}=${check(version, 'version')}`,
    );
  });

  if (required.length)
    lines.push(
      '# Required host packages missing on this node (installed before they were required): from the snapshot only.',
      'lw_missing=()',
      `for spec in ${required.join(' ')}; do`,
      `  if [ "$(dpkg-query -W -f='\${db:Status-Status}' "\${spec%%=*}" 2>/dev/null || true)" != installed ]; then lw_missing+=("$spec"); fi`,
      'done',
      'if [ ${#lw_missing[@]} -gt 0 ]; then',
      '  echo "Required host packages from the snapshot: ${lw_missing[*]}" >&2',
      `  ${apt} -y --no-install-recommends install "\${lw_missing[@]}" || lw_fail "required host packages \${lw_missing[*]}: not installable from the release's apt snapshot"`,
      'fi',
    );

  if (input.kvmModules)
    lines.push(
      '# KVM modules (3.1): linux-modules-extra of the running kernel and the one the next boot runs, at exactly the',
      "# kernel package's version, from the snapshot (Ubuntu ships kvm_intel / kvm_amd there for some flavours).",
      'lw_kvm_module=kvm',
      'if grep -qw vmx /proc/cpuinfo; then lw_kvm_module=kvm_intel; elif grep -qw svm /proc/cpuinfo; then lw_kvm_module=kvm_amd; fi',
      'for KVER in $(printf \'%s\\n\' "$(uname -r)" "$(ls /lib/modules | sort -V | tail -1)" | sort -u); do',
      '  if modinfo -k "$KVER" "$lw_kvm_module" >/dev/null 2>&1; then continue; fi',
      '  v=$(dpkg-query -W -f=\'${Version}\' "linux-image-$KVER" 2>/dev/null || dpkg-query -W -f=\'${Version}\' "linux-image-unsigned-$KVER" 2>/dev/null || true)',
      '  if [ -z "$v" ]; then echo "KVM modules: no kernel package for $KVER" >&2; continue; fi',
      `  ${apt} -y --no-install-recommends install "linux-modules-extra-$KVER=$v" || echo "KVM modules: linux-modules-extra-$KVER=$v is not in the release's apt snapshot; KVM may be unavailable after the next boot" >&2`,
      'done',
    );

  if (input.gvisor) {
    const target = `/usr/local/lib/agenstra-gvisor/${check(input.gvisor.release, 'gVisor release')}`;

    lines.push(
      '# gVisor: the verified release tarball, registered with the shared install script (runtimes reloaded, not restarted).',
      `if [ ! -x ${quote(target + '/runsc')} ]; then`,
      '  mkdir -p /usr/local/lib/agenstra-gvisor',
      '  staging=$(mktemp -d /usr/local/lib/agenstra-gvisor/.staging-XXXXXX)',
      `  tar -xjf ${quote(input.gvisor.tarball)} -C "$staging" --no-same-owner`,
      '  chown -R root:root "$staging"; chmod -R go-w "$staging"; chmod 755 "$staging"',
      `  mv "$staging" ${quote(target)}`,
      'fi',
      // Packages come only from the snapshot (AGENSTRA_KVM_APT=0); the node spec's KVM opt-out skips KVM entirely.
      `${input.gvisor.kvm === false ? 'GVISOR_KVM=0 AGENSTRA_KVM=0 ' : ''}AGENSTRA_KVM_APT=0 bash ${quote(input.gvisor.script)} install`,
    );
  }

  if (input.drbd) {
    const version = quote(drbdVersion);
    const make = `make -C "$src" KDIR="/lib/modules/$KVER/build" SPAAS=${spaas}`;

    lines.push(
      '# DRBD 9 for the kernel the next boot runs (the newest installed one).',
      'KVER=$(ls /lib/modules | sort -V | tail -1)',
      `if [ "$(modinfo -k "$KVER" -F version drbd 2>/dev/null || true)" != ${version} ]; then`,
      '  case "$KVER" in',
      ...prebuilt.map(
        ([kernel, file]) =>
          `    ${quote(kernel)}) mkdir -p "/lib/modules/$KVER/updates/drbd" && tar -xzf ${quote(file)} -C "/lib/modules/$KVER/updates/drbd" --no-same-owner ;;`,
      ),
      '    *)',
      ...(input.drbd.source
        ? [
            ...(input.drbd.signed
              ? []
              : [
                  '      if command -v mokutil >/dev/null 2>&1 && mokutil --sb-state 2>/dev/null | grep -qi "enabled"; then',
                  `        lw_fail "Secure Boot is on and no signed DRBD ${drbdVersion} module ships for $KVER"`,
                  '      fi',
                ]),
            // The compat patches DRBD needs for this kernel, pre-generated at bundle build time: no SPAAS (internet).
            '      case "$KVER" in',
            ...compat.map(([kernel, files, md5s]) => `        ${quote(kernel)}) compat=(${files}); md5s='${md5s}' ;;`),
            spaas
              ? `        *) compat=(); md5s=''; echo "DRBD ${drbdVersion}: no bundled compat patch for $KVER; building with LINBIT's SPAAS (online cluster)" >&2 ;;`
              : `        *) lw_fail "DRBD ${drbdVersion}: the release ships neither a prebuilt module nor a compat patch for kernel $KVER (DRBD builds offline)" ;;`,
            '      esac',
            `      ${apt} -y --no-install-recommends install "linux-headers-$KVER" gcc make`,
            '      src=$(mktemp -d)',
            `      tar -xzf ${quote(input.drbd.source)} -C "$src" --strip-components=1`,
            // Extracted with fresh mtimes, the patch touched last: DRBD's make takes it from the cache (newer than its
            // compat.h and gen_patch_names.c) instead of regenerating it.
            '      for f in "${compat[@]+"${compat[@]}"}"; do tar -xzf "$f" -C "$src/drbd/drbd-kernel-compat" --no-same-owner -m; done',
            '      for m in $md5s; do touch "$src/drbd/drbd-kernel-compat/cocci_cache/$m/compat.patch"; done',
            // Build output kept per kernel (the tail goes to the unit's journal on failure). SPAAS off: headers whose
            // compat.h differs from the release's (another MD5) fail here, visibly, instead of reaching the internet.
            // SPAAS on (online cluster): such headers get their patch from SPAAS.
            '      log="/var/log/loadweaver-drbd-build-$KVER.log"',
            `      if ! ${make} -j"$(nproc)" > "$log" 2>&1; then`,
            '        tail -n 40 "$log" >&2',
            ...(spaas
              ? []
              : [
                  `        if grep -q 'spatch-as-a-service was disabled' "$log"; then lw_fail "DRBD ${drbdVersion}: the compat.h of $KVER's headers differs from the release's pre-generated ones ($md5s); no offline build (log $log)"; fi`,
                ]),
            `        lw_fail "DRBD ${drbdVersion}: build for $KVER failed (log $log)"`,
            '      fi',
            `      ${make} install >> "$log" 2>&1 || { tail -n 40 "$log" >&2; lw_fail "DRBD ${drbdVersion}: install for $KVER failed (log $log)"; }`,
            '      rm -rf "$src"',
          ]
        : [`      lw_fail "no DRBD ${drbdVersion} module for $KVER"`]),
      '      ;;',
      '  esac',
      '  depmod -a "$KVER"',
      // A module built for another kernel (or not installed at all) must fail the update before the reboot, not after.
      `  if [ "$(modinfo -k "$KVER" -F version drbd 2>/dev/null || true)" != ${version} ]; then`,
      `    lw_fail "DRBD ${drbdVersion} is not installed for $KVER"`,
      '  fi',
      'fi',
    );
  }

  lines.push(`echo ok > ${result}`, '');

  return lines.join('\n');
}

/** Whether the next boot runs another kernel or a package asked for a reboot. */
export function rebootRequired(runningKernel: string, installedKernels: readonly string[], flagFile: boolean): boolean {
  if (flagFile) return true;

  const newest = [...installedKernels].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop();

  return !!newest && newest !== runningKernel;
}
