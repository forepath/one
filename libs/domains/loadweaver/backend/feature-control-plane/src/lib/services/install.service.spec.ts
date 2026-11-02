import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { APT_SNAPSHOT_READER, type AptSnapshotReader } from '../updates/apt-snapshot-reader';
import { ClusterIdentityService } from './cluster-identity.service';
import { InstallService } from './install.service';

const CA_PEM = `-----BEGIN CERTIFICATE-----\n${Buffer.from('lab-ca').toString('base64')}\n-----END CERTIFICATE-----\n`;

/** Stands in for the apt snapshot service, which (through artifact store → object store → network state) needs us. */
@Injectable()
class CyclicAptReader implements AptSnapshotReader {
  constructor(readonly install: InstallService) {}

  latest = jest.fn(async () => ({ id: 'snap-1', sources: [] }));
}

describe('InstallService', () => {
  const previousUrl = process.env.LOADWEAVER_PUBLIC_URL;

  beforeEach(() => (process.env.LOADWEAVER_PUBLIC_URL = 'https://cp.example.test'));
  afterEach(() => {
    if (previousUrl === undefined) delete process.env.LOADWEAVER_PUBLIC_URL;
    else process.env.LOADWEAVER_PUBLIC_URL = previousUrl;
  });

  it('boots when the apt snapshot reader depends on it (no constructor cycle) and reads it at render time', async () => {
    const compiled = Test.createTestingModule({
      providers: [
        InstallService,
        CyclicAptReader,
        { provide: APT_SNAPSHOT_READER, useExisting: CyclicAptReader },
        { provide: ClusterIdentityService, useValue: { caCertificate: async () => CA_PEM } },
      ],
    }).compile();
    // A constructor injection of the reader made Nest wait forever here (the control plane hung on boot).
    const module = await Promise.race([
      compiled,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('DI deadlock')), 5_000)),
    ]);
    const reader = module.get(CyclicAptReader);

    expect(reader.install).toBe(module.get(InstallService));
    await expect(module.get(InstallService).script()).resolves.toContain('https://cp.example.test');
    expect(reader.latest).toHaveBeenCalledTimes(1);
  });

  it('renders the installer without a reader or when the reader fails', async () => {
    const identity = { caCertificate: async () => CA_PEM } as unknown as ClusterIdentityService;

    await expect(new InstallService(identity).script()).resolves.toContain('https://cp.example.test');

    const failing = { latest: jest.fn().mockRejectedValue(new Error('db down')) };
    const moduleRef = { get: jest.fn(() => failing) };

    await expect(new InstallService(identity, moduleRef as never).script()).resolves.toContain(
      'https://cp.example.test',
    );
    expect(moduleRef.get).toHaveBeenCalledWith(APT_SNAPSHOT_READER, { strict: false });
    expect(failing.latest).toHaveBeenCalled();
  });
});
