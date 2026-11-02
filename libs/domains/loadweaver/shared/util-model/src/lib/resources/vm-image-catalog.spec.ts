import { clusterSpecSchema } from './infrastructure';
import { clusterVmImageSchema, clusterVmImagesSchema, MAX_CLUSTER_VM_IMAGES } from './vm-image-catalog';
import { resourceJsonSchema } from '../resource';

const SHA256 = 'a'.repeat(64);
const SHA512 = 'b'.repeat(128);
const image = (overrides: Record<string, unknown> = {}) => ({
  name: 'company-base',
  version: '2026.10',
  arch: 'amd64',
  url: 'https://images.example.com/company-base-2026.10.qcow2',
  sha256: SHA256,
  ...overrides,
});

describe('cluster VM image catalog (3.42)', () => {
  it('accepts an entry with exactly one checksum', () => {
    expect(clusterVmImageSchema.parse(image({ firmware: ['uefi', 'bios'], guestAgent: true }))).toMatchObject({
      name: 'company-base',
      firmware: ['uefi', 'bios'],
    });
    expect(clusterVmImageSchema.safeParse(image({ sha256: undefined, sha512: `sha512:${SHA512}` })).success).toBe(true);
    expect(clusterVmImageSchema.safeParse(image({ sha512: SHA512 })).success).toBe(false);
    expect(clusterVmImageSchema.safeParse(image({ sha256: undefined })).success).toBe(false);
    expect(clusterVmImageSchema.safeParse(image({ sha256: 'abc' })).success).toBe(false);
  });

  it('requires https, slugs, known arches and amd64 for bios', () => {
    const ok = (overrides: Record<string, unknown>) => clusterVmImageSchema.safeParse(image(overrides)).success;

    expect(ok({ url: 'http://images.example.com/x.qcow2' })).toBe(false);
    expect(ok({ name: 'Company Base' })).toBe(false);
    expect(ok({ arch: 'riscv64' })).toBe(false);
    expect(ok({ version: 'a b' })).toBe(false);
    expect(ok({ arch: 'arm64', firmware: ['bios'] })).toBe(false);
    expect(ok({ arch: 'arm64', firmware: ['uefi'] })).toBe(true);
    expect(ok({ firmware: ['uefi', 'uefi'] })).toBe(false);
    expect(ok({ extra: true })).toBe(false);
  });

  it('keeps entries unique per name and arch, and bounded', () => {
    expect(
      clusterVmImagesSchema.safeParse({ catalog: [image(), image({ arch: 'arm64', firmware: ['uefi'] })] }).success,
    ).toBe(true);
    expect(clusterVmImagesSchema.safeParse({ catalog: [image(), image({ version: '2' })] }).success).toBe(false);
    expect(
      clusterVmImagesSchema.safeParse({
        catalog: Array.from({ length: MAX_CLUSTER_VM_IMAGES + 1 }, (_, i) => image({ name: `img-${i}` })),
      }).success,
    ).toBe(false);
    expect(clusterVmImagesSchema.parse({})).toEqual({ catalog: [] });
  });

  it('is part of the cluster spec and its published JSON Schema', () => {
    const spec = clusterSpecSchema.parse({
      network: { podPoolV4: '10.0.0.0/8', servicePoolV4: '10.96.0.0/12' },
      vmImages: { catalog: [image()] },
    });

    expect(spec.vmImages?.catalog[0]?.url).toBe('https://images.example.com/company-base-2026.10.qcow2');
    expect(JSON.stringify(resourceJsonSchema('Cluster'))).toContain('vmImages');
  });
});
