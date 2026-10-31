import { RegistryTokenService } from './registry-token.service';

/** Node pull tokens (3.22): only repositories the node's own desired state (or open re-imaging) uses. */
describe('registry pull tokens for nodes', () => {
  function service(state: unknown, commands: unknown[] = []) {
    const find = jest.fn(async () => commands);
    const dataSource = { getRepository: () => ({ find }) };
    const network = { getDesiredState: async () => state };
    const svc = new RegistryTokenService(dataSource as never, network as never);

    jest.spyOn(svc, 'issue').mockResolvedValue('token');

    return { svc, find };
  }

  const vmWorkload = {
    image: 'registry.forenet.internal/forepath/microvm-launcher:1',
    vm: {
      image: {
        ref: 'registry.lw/vms/debian:13@sha256:' + 'a'.repeat(64),
        digest: 'sha256:' + 'a'.repeat(64),
        format: 'qcow2',
        layerDigest: 'sha256:' + 'b'.repeat(64),
      },
    },
  };

  it("lets a node pull its VM's boot image from the built-in registry (G5)", async () => {
    const { svc } = service({ workloads: [vmWorkload] });

    await expect(svc.issueForNode('n1', ['vms/debian'])).resolves.toBe('token');
    await expect(svc.issueForNode('n1', ['vms/other'])).rejects.toThrow('no workload on n1 uses vms/other');
  });

  it('lets a node pull the image of an open re-imaging command (a stopped VM has no workload)', async () => {
    const { svc, find } = service({ workloads: [] }, [
      { payload: { image: { ref: 'registry.lw/vms/debian-raw:13@sha256:' + 'c'.repeat(64) } } },
    ]);

    await expect(svc.issueForNode('n1', ['vms/debian-raw'])).resolves.toBe('token');
    expect(find).toHaveBeenCalledWith({
      where: expect.objectContaining({ node: 'n1', type: 'vmImageImport' }),
    });
    await expect(svc.issueForNode('n1', ['vms/debian'])).rejects.toThrow('no workload on n1 uses vms/debian');
  });

  it('still allows container images of its workloads', async () => {
    const { svc } = service({ workloads: [{ image: 'registry.lw/shop/api:1' }] });

    await expect(svc.issueForNode('n1', ['shop/api'])).resolves.toBe('token');
  });
});
