import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import {
  GVISOR_DEFAULT_RELEASE,
  GVISOR_DEFAULT_RELEASE_SHA512,
  buildGvisorHostScript,
  buildGvisorInstallScript,
} from './gvisor-install.script';

const HOST_SCRIPT_PATH = path.resolve(
  __dirname,
  '../../../../../../../apps/agenstra/backend-agent-manager/host/agenstra-gvisor.sh',
);

function bashSyntaxOk(script: string): boolean {
  const result = spawnSync('bash', ['-n'], { input: script, encoding: 'utf-8' });

  return result.status === 0;
}

describe('gVisor install scripts', () => {
  it('pins the release and verifies the archive checksum', () => {
    const script = buildGvisorInstallScript();

    expect(script).toContain(`GVISOR_RELEASE:-${GVISOR_DEFAULT_RELEASE}`);
    expect(script).toContain(GVISOR_DEFAULT_RELEASE_SHA512.x86_64);
    expect(script).toContain(GVISOR_DEFAULT_RELEASE_SHA512.aarch64);
    expect(script).toContain('sha512sum -c -');
    expect(script).toContain('https://storage.googleapis.com/gvisor/releases/release/');
  });

  it('registers the systrap runtime without changing the default runtime', () => {
    const script = buildGvisorInstallScript();

    expect(script).toContain('install --runtime="$AGENSTRA_GVISOR_RUNTIME" -- --platform=systrap');
    expect(script).toContain('AGENSTRA_GVISOR_RUNTIME="runsc-systrap"');
    // Egress-guarded workers share the guard's namespace: kernel network stack instead of Netstack.
    expect(script).toContain('AGENSTRA_GVISOR_HOSTNET_RUNTIME="runsc-systrap-hostnet"');
    expect(script).toContain('--platform=systrap --network=host');
    expect(script).not.toContain('default-runtime');
  });

  it('verifies runc and gVisor and rolls back on failure', () => {
    const script = buildGvisorInstallScript();

    expect(script).toContain('docker run --rm --runtime=runc');
    expect(script).toContain('docker run --rm --runtime="$AGENSTRA_GVISOR_RUNTIME"');
    expect(script).toContain('agenstra_gvisor_rollback');
    expect(script).toContain('uninstall --runtime="$AGENSTRA_GVISOR_RUNTIME"');
    expect(script).toContain('uninstall --runtime="$AGENSTRA_GVISOR_HOSTNET_RUNTIME"');
    // The previous release stays active on rollback; new releases are staged before activation.
    expect(script).toContain('ln -sfn "$AGENSTRA_GVISOR_PREVIOUS"');
    expect(script).toContain('.staging-XXXXXX');
  });

  it('only restarts Docker on fresh cloud-init hosts, never from the standalone script', () => {
    expect(buildGvisorInstallScript()).toContain('AGENSTRA_DOCKER_RESTART_ALLOWED="1"');
    expect(buildGvisorHostScript()).toContain('AGENSTRA_DOCKER_RESTART_ALLOWED="0"');
  });

  it('never aborts the surrounding cloud-init script on gVisor failures', () => {
    const script = buildGvisorInstallScript();

    expect(script).toContain('if ( agenstra_prepare_gvisor ); then');
    expect(script).toContain('environments use standard Docker (runc)');
    expect(bashSyntaxOk(`#!/bin/bash\nset -euo pipefail\n${script}`)).toBe(true);
  });

  it('requires an explicit checksum for non-default releases', () => {
    const script = buildGvisorInstallScript({ release: '20250915.0' });

    expect(script).toContain('AGENSTRA_GVISOR_SHA512_X86_64=""');
    expect(script).toContain('set GVISOR_SHA512');
  });

  it('rejects unsafe options', () => {
    expect(() => buildGvisorInstallScript({ release: 'latest; rm -rf /' })).toThrow();
    expect(() => buildGvisorInstallScript({ runtimeName: 'runsc --x' })).toThrow();
    expect(() => buildGvisorInstallScript({ sharedNetnsRuntimeName: 'runsc-systrap' })).toThrow();
    expect(() => buildGvisorInstallScript({ release: '20250915.0', sha512: { x86_64: 'abc' } })).toThrow();
    expect(() => buildGvisorInstallScript({ verifyImage: 'img;reboot' })).toThrow();
  });

  it('generates a valid standalone host script with check/install/uninstall', () => {
    const script = buildGvisorHostScript();

    expect(script.startsWith('#!/usr/bin/env bash')).toBe(true);
    expect(script).toContain('check|install|uninstall');
    expect(script).toContain('E_DOCKER_BASELINE_UNAVAILABLE');
    expect(bashSyntaxOk(script)).toBe(true);
  });

  it('keeps the committed host script in sync with the generator', () => {
    expect(fs.readFileSync(HOST_SCRIPT_PATH, 'utf-8')).toBe(buildGvisorHostScript());
  });
});
