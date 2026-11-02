import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { VmImageImportRequestDto } from './virtual-machines.controller';
import { VmImageCatalogController } from './vm-image-catalog.controller';

const REQUIRE_SCOPES_KEY = 'identity.require_scopes';

describe('VmImageCatalogController (3.42)', () => {
  const catalog = {
    catalog: jest.fn().mockResolvedValue({ entries: [] }),
    upstream: jest.fn().mockResolvedValue({ entries: [], warnings: ['fedora: HTTP 503'] }),
  };
  const controller = new VmImageCatalogController(catalog as never);

  it('lists the catalog and the live lookup', async () => {
    await expect(controller.list(undefined)).resolves.toEqual({ entries: [] });
    await expect(controller.upstream(undefined)).resolves.toEqual({ entries: [], warnings: ['fedora: HTTP 503'] });
  });

  it('needs resources:read and throttles the live lookup', () => {
    const proto = VmImageCatalogController.prototype;

    expect(Reflect.getMetadata(REQUIRE_SCOPES_KEY, proto.list)).toEqual(['resources:read']);
    expect(Reflect.getMetadata(REQUIRE_SCOPES_KEY, proto.upstream)).toEqual(['resources:read']);
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', proto.upstream)).toBe(10);
  });

  it('accepts a sha256 or a sha512 on imports', () => {
    const errors = (body: object) =>
      validateSync(
        plainToInstance(VmImageImportRequestDto, { url: 'https://x.example.com/a.qcow2', ref: 'a:1', ...body }),
      ).length;

    expect(errors({ sha256: 'a'.repeat(64) })).toBe(0);
    expect(errors({ sha512: `sha512:${'a'.repeat(128)}` })).toBe(0);
    expect(errors({ sha512: 'a'.repeat(64) })).toBeGreaterThan(0);
    expect(errors({ sha256: 'a'.repeat(128) })).toBeGreaterThan(0);
  });
});
