import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { CommandRunner } from '../host/command-runner';
import type { VolumeManager } from '../volumes/volume.manager';
import { GuestVolumes } from './guest-volumes';

describe('generic microVM volumes (M7 W10b)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lw-guest-volumes-'));
  });

  afterEach(() => rm(dir, { recursive: true, force: true }));

  function setup() {
    const calls: string[] = [];
    const commands = {
      run: jest.fn(async (command: string, args: string[]) => {
        calls.push([command, ...args].join(' '));

        return { stdout: '', stderr: '' };
      }),
    };
    const volumes = {
      mount: jest.fn(async () => '/var/lib/loadweaver/volumes/data'),
      takeOverForMigration: jest.fn(async () => '/var/lib/loadweaver/volumes/data'),
      releaseForMigration: jest.fn(async () => undefined),
      unmount: jest.fn(async () => undefined),
    };
    const guest = new GuestVolumes(commands as unknown as CommandRunner, volumes as unknown as VolumeManager);

    return { guest, calls, volumes };
  }

  const data = { index: 0, volume: 'p/web/data', target: '/data', readOnly: false };
  const config = { index: 1, volume: 'p/web/config', target: '/etc/app', readOnly: true };

  it('shares the directory (bind + shared propagation) and mounts each volume below it', async () => {
    const { guest, calls, volumes } = setup();
    const shared = join(dir, 'vmvol');

    await guest.prepareDir(shared, [data, config]);
    expect(calls).toEqual([`mount --bind ${shared} ${shared}`, `mount --make-shared ${shared}`]);
    expect((await readdir(shared)).sort()).toEqual(['0', '1']);

    calls.length = 0;
    await guest.attach(shared, data);
    await guest.attach(shared, config);
    expect(volumes.mount).toHaveBeenCalledWith('lw-vol-p.web.data');
    expect(calls).toEqual([
      `mount --bind /var/lib/loadweaver/volumes/data ${shared}/0`,
      `mount --bind /var/lib/loadweaver/volumes/data ${shared}/1`,
      `mount -o remount,bind,ro ${shared}/1`,
    ]);

    // The migration target takes a volume over (outside the control plane's primary rule, inside the hold).
    await guest.attach(shared, data, true);
    expect(volumes.takeOverForMigration).toHaveBeenCalledWith('p/web/data');
  });

  it('lets go strictly in a hand-over and as the volume plugin did on removal', async () => {
    const { guest, calls, volumes } = setup();
    const shared = join(dir, 'vmvol');

    await guest.prepareDir(shared, [data]);
    calls.length = 0;
    await guest.detach(shared, data, 'migration');
    expect(calls).toEqual([`umount ${shared}/0`]);
    expect(volumes.releaseForMigration).toHaveBeenCalledWith('p/web/data');

    await guest.release(shared, [data]);
    expect(volumes.unmount).toHaveBeenCalledWith('lw-vol-p.web.data');
    await expect(stat(shared)).rejects.toThrow();
  });
});
