import { WorkloadManager } from './workload.manager';

describe('WorkloadManager drift report (3.8)', () => {
  it('lists containers Loadweaver does not manage, with their published ports', async () => {
    const docker = {
      listContainers: jest.fn(async () => [
        {
          Id: 'a'.repeat(64),
          Names: ['/legacy-web'],
          Image: 'nginx:1.27',
          State: 'running',
          Labels: {},
          Ports: [
            { IP: '0.0.0.0', PublicPort: 8088, PrivatePort: 80, Type: 'tcp' },
            { PrivatePort: 443, Type: 'tcp' },
          ],
        },
        {
          Id: 'b'.repeat(64),
          Names: ['/lw-shop-site-web-0'],
          Image: 'x',
          State: 'running',
          Labels: { 'loadweaver.com/managed': 'true' },
          Ports: [],
        },
      ]),
    };
    const manager = new WorkloadManager(docker as never, {} as never, {} as never);

    expect(await manager.foreign()).toEqual([
      {
        id: 'a'.repeat(64),
        name: 'legacy-web',
        image: 'nginx:1.27',
        state: 'running',
        ports: ['0.0.0.0:8088->80/tcp'],
      },
    ]);
    expect(docker.listContainers).toHaveBeenCalledWith({ all: true });
  });
});
