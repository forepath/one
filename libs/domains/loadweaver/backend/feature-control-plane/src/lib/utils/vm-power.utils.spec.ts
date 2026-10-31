import { VmPowerEntity } from '../entities/virtual-machine.entities';
import { forgetVmOperationalState, loadVmOperationalState } from './vm-power.utils';

describe('VM operational state', () => {
  it('is gone with the VM, so a VM created again under its name starts fresh (G5)', async () => {
    let rows = [{ project: 'vms', name: 'db', desired: 'stopped', instanceGeneration: 3 }];
    const repo = {
      find: async () => rows,
      delete: jest.fn(async (where: { project: string; name: string }) => {
        rows = rows.filter((r) => r.project !== where.project || r.name !== where.name);
      }),
    };
    const manager = { getRepository: (entity: unknown) => (entity === VmPowerEntity ? repo : undefined) } as never;

    expect((await loadVmOperationalState(manager)).power.get('vms/db')).toBe('stopped');
    await forgetVmOperationalState(manager, 'vms', 'db');
    expect(repo.delete).toHaveBeenCalledWith({ project: 'vms', name: 'db' });

    const after = await loadVmOperationalState(manager);

    expect(after.power.has('vms/db')).toBe(false);
    expect(after.generations.has('vms/db')).toBe(false);
  });
});
