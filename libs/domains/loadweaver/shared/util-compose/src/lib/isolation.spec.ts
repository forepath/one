import { parseCompose, type ComposeParseOptions } from './parse-compose';
import type { ComposeIssue, ServiceSpec } from './model';

/** Isolation ladder (3.1), `devices` allow-list and `runtime: microvm` (3.35) in compose. */
const options: ComposeParseOptions = {
  name: 'shop',
  project: 'shop',
  defaultRequests: { cpuMillis: 250, memoryBytes: 256 * 1024 ** 2 },
};

function service(body: string): string {
  return `services:\n  a:\n    image: x\n    deploy: { resources: { limits: { cpus: '1', memory: 1g } } }\n${body
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => `    ${l}`)
    .join('\n')}\n`;
}

function parsed(body: string): { service: ServiceSpec; warnings: ComposeIssue[] } {
  const result = parseCompose(service(body), options);

  if (!result.ok) throw new Error(JSON.stringify(result.issues));

  return { service: result.deployment.services[0], warnings: result.warnings };
}

function errors(body: string): ComposeIssue[] {
  const result = parseCompose(service(body), options);

  if (result.ok) throw new Error('expected errors');

  return result.issues.filter((i) => i.level === 'error');
}

describe('isolation levels', () => {
  it.each(['runc', 'sandboxed', 'sandboxed-kvm', 'microvm'] as const)('accepts x-loadweaver.runtime %s', (level) => {
    expect(parsed(`x-loadweaver: { runtime: ${level} }`).service.runtime).toBe(level);
  });

  it('defaults to runc', () => {
    expect(parsed('').service.runtime).toBe('runc');
  });

  it('refuses an unknown x-loadweaver.runtime', () => {
    expect(errors('x-loadweaver: { runtime: kata }')).toEqual([
      expect.objectContaining({ path: 'services.a.x-loadweaver.runtime' }),
    ]);
  });

  it.each([
    ['runc', 'runc'],
    ['runsc', 'sandboxed'],
    ['runsc-systrap', 'sandboxed'],
    ['runsc-kvm', 'sandboxed-kvm'],
  ] as const)('maps the compose runtime %s to %s', (docker, level) => {
    expect(parsed(`runtime: ${docker}`).service.runtime).toBe(level);
  });

  it.each(['nvidia', 'runsc-systrap-hostnet', 'kata-runtime'])('refuses the compose runtime %s', (docker) => {
    expect(errors(`runtime: ${docker}`)).toEqual([
      {
        level: 'error',
        path: 'services.a.runtime',
        message: `unknown runtime ${docker}, use x-loadweaver.runtime`,
      },
    ]);
  });

  it('lets x-loadweaver.runtime win over the compose runtime and says so', () => {
    const result = parsed('runtime: runsc\nx-loadweaver: { runtime: microvm }');

    expect(result.service.runtime).toBe('microvm');
    expect(result.warnings).toContainEqual({
      level: 'warning',
      path: 'services.a.runtime',
      message: 'runtime runsc is overridden by x-loadweaver.runtime: microvm',
    });
    expect(parsed('runtime: runsc-kvm\nx-loadweaver: { runtime: sandboxed-kvm }').warnings).toEqual([]);
  });
});

describe('devices allow-list', () => {
  it.each([
    ['"/dev/kvm"', 'rwm'],
    ['"/dev/kvm:/dev/kvm"', 'rwm'],
    ['"/dev/kvm:/dev/kvm:rw"', 'rw'],
    ['"/dev/kvm:rwm"', 'rwm'],
    ['{ source: /dev/kvm, target: /dev/kvm, permissions: rw }', 'rw'],
    ['{ source: /dev/kvm }', 'rwm'],
  ])('accepts %s on runc, pinned and with the VM warning', (entry, permissions) => {
    const result = parsed(`devices: [${entry}]\nx-loadweaver: { pinned: { reason: "runs its own VMs" } }`);

    expect(result.service.devices).toEqual(['/dev/kvm']);
    expect(result.service.deviceAccess).toEqual([{ path: '/dev/kvm', permissions }]);
    expect(result.service.pins).toEqual([{ kind: 'deployment', reason: 'device access (/dev/kvm)' }]);
    expect(result.warnings).toEqual([
      {
        level: 'warning',
        path: 'services.a.devices',
        message: 'device access (/dev/kvm): the workload can run its own VMs; it is pinned for migration',
      },
    ]);
  });

  it('has no devices by default', () => {
    expect(parsed('').service).toMatchObject({ devices: [], deviceAccess: [], pins: [] });
  });

  it.each([
    ['"/dev/nvidia0"', 'services.a.devices[0]', 'device /dev/nvidia0 is not allowed (allow-list: /dev/kvm)'],
    ['"/dev/net/tun"', 'services.a.devices[0]', 'device /dev/net/tun is not allowed (allow-list: /dev/kvm)'],
    ['{ target: /dev/kvm }', 'services.a.devices[0]', 'device (empty) is not allowed (allow-list: /dev/kvm)'],
    [
      '"/dev/kvm:/dev/kvm0"',
      'services.a.devices[0]',
      'device /dev/kvm must keep its path in the container (/dev/kvm:/dev/kvm)',
    ],
    ['"/dev/kvm:/dev/kvm:r"', 'services.a.devices[0]', 'device /dev/kvm permissions must be rw or rwm'],
    ['"/dev/kvm:/dev/kvm:rwm:x"', 'services.a.devices[0]', 'invalid device /dev/kvm:/dev/kvm:rwm:x'],
    ['"/dev/kvm", "/dev/kvm:rw"', 'services.a.devices[1]', 'device /dev/kvm is listed twice'],
    ['42', 'services.a.devices[0]', 'a device is a string or a map with source / target / permissions'],
  ])('refuses %s', (entry, path, message) => {
    expect(errors(`devices: [${entry}]`)).toEqual([{ level: 'error', path, message }]);
  });

  it('refuses a devices value that is not a list', () => {
    expect(errors('devices: /dev/kvm')).toEqual([
      { level: 'error', path: 'services.a.devices', message: 'devices must be a list' },
    ]);
  });

  it.each(['sandboxed', 'sandboxed-kvm', 'microvm'])('refuses /dev/kvm with runtime %s', (level) => {
    expect(errors(`devices: ["/dev/kvm"]\nx-loadweaver: { runtime: ${level} }`)).toEqual([
      {
        level: 'error',
        path: 'services.a.devices',
        message: `devices need runtime runc: runtime ${level} can't pass host devices through (/dev/kvm)`,
      },
    ]);
  });
});

describe('runtime: microvm', () => {
  it('takes the writable layer size from x-loadweaver.microvm', () => {
    expect(parsed('x-loadweaver: { runtime: microvm, microvm: { rootfsSize: 10Gi } }').service.microvm).toEqual({
      rootfsBytes: 10 * 1024 ** 3,
    });
    expect(parsed('x-loadweaver: { runtime: microvm, microvm: { rootfsSize: 1073741824 } }').service.microvm).toEqual({
      rootfsBytes: 1024 ** 3,
    });
  });

  it('leaves the size to the planner when not given', () => {
    expect(parsed('x-loadweaver: { runtime: microvm }').service.microvm).toEqual({});
    expect(parsed('x-loadweaver: { runtime: sandboxed-kvm }').service.microvm).toBeUndefined();
  });

  it('refuses an invalid writable layer size', () => {
    expect(errors('x-loadweaver: { runtime: microvm, microvm: { rootfsSize: lots } }')).toEqual([
      { level: 'error', path: 'services.a.x-loadweaver.microvm.rootfsSize', message: 'invalid size' },
    ]);
  });

  it('refuses microvm settings without runtime microvm', () => {
    expect(errors('x-loadweaver: { runtime: sandboxed, microvm: { rootfsSize: 1g } }')).toEqual([
      {
        level: 'error',
        path: 'services.a.x-loadweaver.microvm',
        message: 'microvm settings need x-loadweaver.runtime: microvm',
      },
    ]);
  });

  it('refuses host networking and privileged mode', () => {
    expect(errors('network_mode: host\nprivileged: true\nx-loadweaver: { runtime: microvm }')).toEqual([
      {
        level: 'error',
        path: 'services.a.network_mode',
        message: 'network_mode: host is not supported with runtime microvm (the guest owns the workload IP)',
      },
      {
        level: 'error',
        path: 'services.a.privileged',
        message: 'privileged is not supported with runtime microvm (the guest has its own kernel)',
      },
    ]);
  });

  it('warns that cap_add applies inside the guest instead of the spoofing warning', () => {
    const { warnings } = parsed('cap_add: [NET_ADMIN]\nx-loadweaver: { runtime: microvm }');

    expect(warnings).toEqual([
      {
        level: 'warning',
        path: 'services.a.cap_add',
        message:
          'cap_add has no effect on the microVM: the workload runs in its own guest kernel, where capabilities apply unrestricted',
      },
    ]);
    expect(parsed('cap_add: [NET_ADMIN]').warnings.map((w) => w.message)).toEqual([
      "NET_ADMIN lets the service send with other workloads' addresses on its node (their policies and identities)",
    ]);
  });
});
