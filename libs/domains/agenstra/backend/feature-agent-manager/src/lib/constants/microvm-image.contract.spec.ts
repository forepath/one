import { readFileSync } from 'fs';
import { join } from 'path';

import {
  MICROVM_BRIDGE_PROTOCOL_VERSION,
  MICROVM_EXEC_CLIENT_PATH,
  MICROVM_EXEC_SOCKET,
  MICROVM_PROTOCOL_LABEL,
  MICROVM_RUNTIME_DIR,
  MICROVM_VMM_UID,
  MICROVM_VMM_USER,
} from '@forepath/agenstra/backend/util-microvm-bridge';

import { MICROVM_GUEST_ROOT } from './container-isolation.constants';
import { EGRESS_GUARD_EXPLICIT_PROXY_PORT } from './egress-guard.constants';

const APP_ROOT = join(__dirname, '../../../../../../../../apps/agenstra/backend-agent-manager');
const dockerfile = readFileSync(join(APP_ROOT, 'Dockerfile.worker-microvm'), 'utf8');
const launcher = readFileSync(join(APP_ROOT, 'worker-microvm/launch'), 'utf8');

/**
 * The microVM worker image (Dockerfile + launcher script) and the agent manager / bridge code must agree on the
 * contract between them; a drift would break exec, the environment file or the egress guard's loopback proxy.
 */
describe('microVM worker image contract', () => {
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
    expect(dockerfile).toContain(`--uid ${MICROVM_VMM_UID} `);
    expect(dockerfile).toMatch(new RegExp(`--shell /usr/sbin/nologin ${MICROVM_VMM_USER}\\b`));
    expect(launcher).toContain(`readonly VMM_USER=${MICROVM_VMM_USER}`);
    expect(MICROVM_VMM_UID).not.toBe(10902);
  });

  it('serves exec on the paths the client and the manager expect', () => {
    expect(launcher).toContain(`readonly RUN_DIR=${MICROVM_RUNTIME_DIR}`);
    expect(MICROVM_EXEC_SOCKET).toBe(`${MICROVM_RUNTIME_DIR}/vmm/exec.sock`);
    expect(launcher).toContain('--exec-socket "${VMM_DIR}/exec.sock"');
    expect(dockerfile).toContain(MICROVM_EXEC_CLIENT_PATH);
  });

  it('only executes binaries of the launcher root (never the guest-writable tree)', () => {
    expect(launcher).toContain('export PATH=/usr/sbin:/usr/bin:/sbin:/bin');
    expect(launcher).not.toMatch(/\/guest\/(usr|bin|sbin|lib)/);
  });
});
