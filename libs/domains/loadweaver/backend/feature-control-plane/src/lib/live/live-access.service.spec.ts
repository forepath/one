import { ForbiddenException, NotFoundException } from '@nestjs/common';

import { LiveAccessService } from './live-access.service';

describe('LiveAccessService VM consoles (3.35)', () => {
  const setup = (role: string | undefined, options: { developerExec?: boolean; graphical?: boolean | null } = {}) => {
    const placements = new Map([['shop/lw-vm/db1/0', { id: 'shop/lw-vm/db1/0', project: 'shop', node: 'n1' }]]);
    const dataSource = {
      getRepository: () => ({ findOne: async ({ where }: { where: { id: string } }) => placements.get(where.id) }),
      manager: {},
    };
    const access = {
      caller: async () => ({ isApiKey: false, projects: new Map(role ? [['shop', role]] : []) }),
      settings: async () => ({ developerExec: options.developerExec ?? false }),
    };
    const resources = {
      get: jest.fn(async (kind: string, name: string, project: string) =>
        kind === 'VirtualMachine' && name === 'db1' && project === 'shop' && options.graphical !== null
          ? { spec: { console: { graphical: options.graphical ?? true } } }
          : null,
      ),
    };

    return new LiveAccessService(dataSource as never, access as never, resources as never);
  };

  it('opens consoles for operators and admins, developers only when the project allows exec, viewers never', async () => {
    await expect(setup('operator').console(undefined, 'shop/lw-vm/db1/0', 'serial')).resolves.toMatchObject({
      node: 'n1',
      project: 'shop',
      target: 'replica/shop/lw-vm/db1/0',
    });
    await expect(setup('admin').console(undefined, 'shop/lw-vm/db1/0', 'vnc')).resolves.toMatchObject({ node: 'n1' });
    await expect(setup('developer').console(undefined, 'shop/lw-vm/db1/0', 'serial')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      setup('developer', { developerExec: true }).console(undefined, 'shop/lw-vm/db1/0', 'serial'),
    ).resolves.toMatchObject({ node: 'n1' });
    await expect(setup('viewer').console(undefined, 'shop/lw-vm/db1/0', 'serial')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(setup(undefined).console(undefined, 'shop/lw-vm/db1/0', 'serial')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('refuses replicas that are not VMs, VNC without a graphical console, and unknown VMs', async () => {
    await expect(setup('operator').console(undefined, 'shop/site/web/0', 'serial')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(setup('operator', { graphical: false }).console(undefined, 'shop/lw-vm/db1/0', 'vnc')).rejects.toThrow(
      'the virtual machine has no graphical console',
    );
    // The serial console exists either way.
    await expect(
      setup('operator', { graphical: false }).console(undefined, 'shop/lw-vm/db1/0', 'serial'),
    ).resolves.toMatchObject({ node: 'n1' });
    await expect(
      setup('operator', { graphical: null }).console(undefined, 'shop/lw-vm/db1/0', 'vnc'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
