import {
  MICROVM_EXEC_CLIENT_PATH,
  MICROVM_PROTOCOL_LABEL,
  MICROVM_VMM_USER,
} from '@forepath/shared/backend/util-microvm-bridge';

import {
  guestExecOptions,
  guestFileRoot,
  guestKind,
  isMicrovm,
  MICROVM_LABEL,
  VM_EXEC_REFUSED,
  VM_LABEL,
} from './guest-target';

describe('guest targets of live sessions', () => {
  it('tells containers, bundled / generic microVMs and full VMs apart by their labels', () => {
    expect(guestKind(undefined)).toBe('container');
    expect(guestKind({ app: 'web' })).toBe('container');
    expect(guestKind({ [MICROVM_LABEL]: 'generic' })).toBe('microvm-generic');
    expect(guestKind({ [MICROVM_LABEL]: 'bundled' })).toBe('microvm-bundled');
    // Agenstra's launcher-labelled worker images (the image label is part of the container's labels).
    expect(guestKind({ [MICROVM_PROTOCOL_LABEL]: '1' })).toBe('microvm-bundled');
    expect(guestKind({ [VM_LABEL]: 'db1', [MICROVM_PROTOCOL_LABEL]: '1' })).toBe('vm');
    expect(isMicrovm('microvm-generic') && isMicrovm('microvm-bundled')).toBe(true);
    expect(isMicrovm('vm') || isMicrovm('container')).toBe(false);
  });

  it('wraps exec through vm-exec in microVMs (env values stay in Env), leaves containers alone, refuses VMs', () => {
    const options = {
      Cmd: ['sh', '-c', 'id'],
      Env: ['TERM=xterm-256color', 'A=1'],
      User: '1000:1000',
      WorkingDir: '/app',
      Tty: true,
    };

    expect(guestExecOptions('container', options)).toBe(options);

    for (const kind of ['microvm-generic', 'microvm-bundled'] as const) {
      const wrapped = guestExecOptions(kind, options);

      expect(wrapped.Cmd).toEqual([
        MICROVM_EXEC_CLIENT_PATH,
        '--user',
        '1000:1000',
        '--workdir',
        '/app',
        '--pass-env',
        'TERM',
        '--pass-env',
        'A',
        '--',
        'sh',
        '-c',
        'id',
      ]);
      expect(wrapped).toMatchObject({ User: MICROVM_VMM_USER, Env: options.Env, Tty: true });
      expect(wrapped).not.toHaveProperty('WorkingDir');
    }

    expect(() => guestExecOptions('vm', options)).toThrow(VM_EXEC_REFUSED);
  });

  it("browses a microVM guest's root: the generic overlay's merged dir, the bundled image's /guest", () => {
    const info = {
      GraphDriver: { Data: { MergedDir: '/var/lib/docker/overlay2/abc/merged' } },
      Mounts: [
        { Type: 'volume', Source: '/var/lib/docker/volumes/x', Destination: '/guest/data' },
        { Type: 'bind', Source: '/var/lib/loadweaver/vmroot/replicas/0123/merged', Destination: '/guest' },
      ],
    };

    expect(guestFileRoot('microvm-generic', info)).toBe('/var/lib/loadweaver/vmroot/replicas/0123/merged');
    expect(guestFileRoot('microvm-bundled', info)).toBe('/var/lib/docker/overlay2/abc/merged/guest');
    expect(guestFileRoot('container', info)).toBeNull();
    expect(() => guestFileRoot('microvm-generic', { Mounts: [] })).toThrow('not mounted');
    expect(() => guestFileRoot('microvm-bundled', {})).toThrow('no browsable filesystem');
    expect(() => guestFileRoot('vm', info)).toThrow('not browsable');
  });
});
