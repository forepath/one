import { readFileSync } from 'fs';
import { join } from 'path';

import {
  MICROVM_BRIDGE_PROTOCOL_VERSION,
  MICROVM_EXEC_CLIENT_PATH,
  MICROVM_EXEC_SOCKET,
  MICROVM_INSTALL_DIR,
  MICROVM_PROTOCOL_LABEL,
  MICROVM_RUNTIME_DIR,
  MICROVM_VMM_UID,
  MICROVM_VMM_USER,
} from '@forepath/shared/backend/util-microvm-bridge';

import { MICROVM_GUEST_ROOT } from './container-isolation.constants';
import { EGRESS_GUARD_EXPLICIT_PROXY_PORT } from './egress-guard.constants';

const REPO_ROOT = join(__dirname, '../../../../../../../..');
const dockerfile = readFileSync(
  join(REPO_ROOT, 'apps/agenstra/backend-agent-manager/Dockerfile.worker-microvm'),
  'utf8',
);
/** The shared launcher image the worker image is built on (`FROM ${LAUNCHER_IMAGE}`). */
const LAUNCHER_ROOT = join(REPO_ROOT, 'apps/shared/microvm-launcher');
const launcherDockerfile = readFileSync(join(LAUNCHER_ROOT, 'Dockerfile'), 'utf8');
const launcher = readFileSync(join(LAUNCHER_ROOT, 'rootfs', MICROVM_INSTALL_DIR, 'launch'), 'utf8');

/**
 * The microVM worker image (Dockerfile on the shared launcher image + launcher script) and the agent manager / bridge
 * code must agree on the contract between them; a drift would break exec, the environment file or the egress guard's
 * loopback proxy.
 */
describe('microVM worker image contract', () => {
  it('is built on the shared launcher image and keeps the bundled launcher entrypoint', () => {
    expect(dockerfile).toContain('ARG LAUNCHER_IMAGE=ghcr.io/forepath/microvm-launcher:${VERSION}');
    expect(dockerfile).toContain('FROM ${LAUNCHER_IMAGE} AS launcher');
    expect(dockerfile).toContain('FROM launcher\n');
    expect(dockerfile).toContain(`ENTRYPOINT ["/usr/bin/tini", "--", "${MICROVM_INSTALL_DIR}/launch"]`);
    expect(dockerfile).toContain(`COPY --chmod=0755 --from=launcher ${MICROVM_INSTALL_DIR}/guest-init`);
    expect(dockerfile).toContain(`COPY --chmod=0644 --from=launcher ${MICROVM_INSTALL_DIR}/pty-helper.py`);
    expect(dockerfile).toContain(`COPY --chmod=0644 --from=launcher ${MICROVM_INSTALL_DIR}/bridge-guest.cjs`);
    // The bundled initramfs the launcher boots (`initramfs.img`, switch_root into /guest).
    expect(launcherDockerfile).toContain('initramfs:agenstra-initramfs-init ');
    expect(launcher).toContain('<initrd>${INSTALL_DIR}/initramfs.img</initrd>');
    expect(launcherDockerfile).toMatch(/rootfs\/usr\/lib\/agenstra-microvm\/launch /);
  });

  it('advertises the bridge protocol this manager speaks', () => {
    expect(dockerfile).toContain(`LABEL ${MICROVM_PROTOCOL_LABEL}="${MICROVM_BRIDGE_PROTOCOL_VERSION}"`);
  });

  it("relays the egress guard's explicit proxy port from the guest loopback", () => {
    expect(dockerfile).toContain(`ENV AGENSTRA_MICROVM_LOOPBACK_PORTS=${EGRESS_GUARD_EXPLICIT_PROXY_PORT}`);
  });

  it('keeps the worker filesystem below the guest root the manager mounts volumes into', () => {
    expect(dockerfile).toContain(`COPY --link --from=guest / ${MICROVM_GUEST_ROOT}/`);
    expect(launcher).toContain(`readonly GUEST_ROOT=${MICROVM_GUEST_ROOT}`);
  });

  it('runs the VMM as the unprivileged user the exec rewrite uses, never the guard-exempt uid', () => {
    expect(launcherDockerfile).toContain(`--uid ${MICROVM_VMM_UID} `);
    expect(launcherDockerfile).toMatch(new RegExp(`--shell /usr/sbin/nologin ${MICROVM_VMM_USER}\\b`));
    expect(launcher).toContain(`readonly VMM_USER=${MICROVM_VMM_USER}`);
    expect(MICROVM_VMM_UID).not.toBe(10902);
  });

  it('serves exec on the paths the client and the manager expect', () => {
    expect(launcher).toContain(`readonly RUN_DIR=${MICROVM_RUNTIME_DIR}`);
    expect(MICROVM_EXEC_SOCKET).toBe(`${MICROVM_RUNTIME_DIR}/vmm/exec.sock`);
    expect(launcher).toContain('--exec-socket "${VMM_DIR}/exec.sock"');
    expect(launcherDockerfile).toContain(MICROVM_EXEC_CLIENT_PATH);
  });

  it('only executes binaries of the launcher root (never the guest-writable tree)', () => {
    expect(launcher).toContain('export PATH=/usr/sbin:/usr/bin:/sbin:/bin');
    expect(launcher).not.toMatch(/\/guest\/(usr|bin|sbin|lib)/);
  });
});
