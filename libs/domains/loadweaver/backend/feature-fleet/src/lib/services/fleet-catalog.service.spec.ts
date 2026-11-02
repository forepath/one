import {
  buildPackageArchive,
  generateSigningKeyPair,
  parseIndex,
  publicKeyId,
  verifyBlob,
  verifyIndex,
  verifyPackage,
} from '@forepath/loadweaver/shared/util-app-catalog';
import { BadRequestException, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { FindOperator } from 'typeorm';

import type {
  FleetCatalogIndexEntity,
  FleetCatalogKeyEntity,
  FleetCatalogPackageEntity,
  FleetCatalogTakedownEntity,
} from '../entities/fleet-catalog.entities';
import type { FleetCaller } from '../utils/fleet-access.utils';
import { FleetCatalogService } from './fleet-catalog.service';

const DIGEST = `sha256:${'a'.repeat(64)}`;
const admin: FleetCaller = { userId: 'u1', isApiKey: false, isAdmin: true, label: 'fleet:admin@example.com' };

function archive(
  version = '1.2.0',
  compose = `services:\n  web:\n    image: ghcr.io/acme/wiki@${DIGEST}\n`,
  readme = '# Wiki\n',
  extra = '',
): Buffer {
  return buildPackageArchive({
    readme: readme,
    compose: compose,
    manifest: `apiVersion: apps.loadweaver.com/v1
name: wiki
version: ${version}
title: Wiki
description: A small wiki.
publisher: acme
license: MIT
homepage: https://example.com/wiki
docs: https://example.com/wiki/docs
channels: [stable, beta]
${extra}`,
  });
}

/** Minimal in-memory repository (where = flat equality, plus TypeORM's `IsNull()` / `MoreThan()`). */
function repo<T extends object>(key: keyof T, idFor: () => unknown = () => undefined) {
  const rows: T[] = [];
  const matches = (row: T, where: Partial<T> = {}) =>
    Object.entries(where).every(([k, v]) => {
      const actual = (row as Record<string, unknown>)[k];

      if (v instanceof FindOperator) {
        if (v.type === 'isNull') return actual === null || actual === undefined;

        if (v.type === 'moreThan') return String(actual) > String(v.value);
      }

      return actual === v;
    });

  return {
    rows,
    create: (v: Partial<T>) => ({ ...v }) as T,
    save: jest.fn(async (v: T) => {
      const record = v as Record<string, unknown>;

      if (record[key as string] === undefined) record[key as string] = idFor();

      record['createdAt'] ??= new Date();

      const index = rows.findIndex((r) => (r as Record<string, unknown>)[key as string] === record[key as string]);

      if (index >= 0) rows[index] = { ...v };
      else rows.push({ ...v });

      return v;
    }),
    findOne: jest.fn(async ({ where }: { where: Partial<T> }) => {
      const row = rows.find((r) => matches(r, where));

      return row ? { ...row } : null;
    }),
    find: jest.fn(async (options: { where?: Partial<T>; take?: number } = {}) =>
      rows.filter((r) => matches(r, options.where)).slice(0, options.take),
    ),
    update: jest.fn(async (where: Partial<T>, patch: Partial<T>) => {
      for (const row of rows) if (matches(row, where)) Object.assign(row, patch);
    }),
    delete: jest.fn(async (where: Partial<T>) => {
      const index = rows.findIndex((r) => matches(r, where));

      if (index >= 0) rows.splice(index, 1);
    }),
  };
}

function setup() {
  let id = 0;
  const keys = repo<FleetCatalogKeyEntity>('kid');
  const packages = repo<FleetCatalogPackageEntity>(
    'id',
    () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
  );
  const takedowns = repo<FleetCatalogTakedownEntity>(
    'id',
    () => `10000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
  );
  const indexes = repo<FleetCatalogIndexEntity>('id');
  const audit = { record: jest.fn(async () => undefined) };
  const service = new FleetCatalogService(
    keys as never,
    packages as never,
    takedowns as never,
    indexes as never,
    audit as never,
  );

  return { service, keys, packages, takedowns, indexes, audit };
}

describe('FleetCatalogService', () => {
  it('creates the catalog key once on the first start and keeps the private key out of every answer', async () => {
    const { service, keys } = setup();

    await service.onApplicationBootstrap();

    expect(keys.rows).toHaveLength(1);
    expect(keys.rows[0].type).toBe('ecdsa-p256');
    expect(keys.rows[0].kid).toBe(publicKeyId(keys.rows[0].publicKey));

    await service.signingKey();
    expect(keys.rows).toHaveLength(1);

    const info = await service.info();

    expect(info).toMatchObject({ name: 'fleet', publisher: 'fleet', trust: 'verified', keyId: keys.rows[0].kid });
    expect(JSON.stringify(info)).not.toContain('PRIVATE KEY');
    expect(await service.publicKey()).toContain('BEGIN PUBLIC KEY');
  });

  it('re-reads the key another replica created concurrently', async () => {
    const { service, keys } = setup();
    const pair = generateSigningKeyPair('ecdsa-p256');
    const theirs = {
      kid: pair.keyId,
      type: pair.type,
      publicKey: pair.publicKeyPem,
      privateKey: pair.privateKeyPem,
      state: 'active',
      createdAt: new Date(),
      retiredAt: null,
    } as FleetCatalogKeyEntity;

    keys.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(theirs);
    keys.save.mockRejectedValueOnce(new Error('duplicate key'));

    expect((await service.signingKey()).kid).toBe(pair.keyId);
  });

  it('uploads a package as a signed draft with its findings', async () => {
    const { service, packages, keys, audit } = setup();
    const bytes = archive();
    const dto = await service.upload(admin, bytes);

    expect(dto).toMatchObject({ app: 'wiki', version: '1.2.0', channel: 'stable', status: 'draft', takenDown: false });
    expect(packages.rows[0].signedBy).toBe(keys.rows[0].kid);
    expect(verifyBlob(bytes, packages.rows[0].signature, [keys.rows[0].publicKey]).ok).toBe(true);
    expect(JSON.stringify(dto)).not.toContain('archive');
    expect(audit.record).toHaveBeenCalledWith(
      admin,
      'catalog.package-uploaded',
      'catalog/wiki/1.2.0',
      expect.anything(),
    );
  });

  it('refuses invalid packages (lint errors block) and other content for an existing version', async () => {
    const { service } = setup();

    await expect(
      service.upload(
        admin,
        archive('1.2.0', `services:\n  web:\n    image: ghcr.io/acme/wiki@${DIGEST}\n    privileged: true\n`),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.upload(admin, Buffer.alloc(0))).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.upload(admin, archive(), { channel: 'edge' })).rejects.toBeInstanceOf(BadRequestException);

    await service.upload(admin, archive());
    // The identical archive again: idempotent.
    await expect(service.upload(admin, archive())).resolves.toMatchObject({ version: '1.2.0' });
    // Different bytes for the same version (another README): refused.
    const other = archive('1.2.0', undefined, '# Other\n');

    await expect(service.upload(admin, other)).rejects.toBeInstanceOf(ConflictException);
  });

  it('publishes into a signed index that clusters verify, serves the package and its signature', async () => {
    const { service } = setup();
    const bytes = archive();

    await service.upload(admin, bytes, { publish: true });

    const key = await service.publicKey();
    const index = await service.servedIndex();
    const sig = await service.servedIndexSignature();
    const verified = verifyIndex(index.body, { kind: 'blob', signature: sig.body.toString('utf8') }, [key]);

    expect(verified.ok).toBe(true);

    const parsed = verified.ok === true ? verified.value.index : null;

    expect(parsed?.apps.map((a) => a.name)).toEqual(['wiki']);

    const pkg = await service.servedPackage('wiki', '1.2.0', false);
    const pkgSig = await service.servedPackage('wiki', '1.2.0', true);

    expect(pkg.body.equals(bytes)).toBe(true);
    expect(
      verifyPackage({
        index: parsed as never,
        app: 'wiki',
        version: '1.2.0',
        archive: pkg.body,
        signature: { kind: 'blob', signature: pkgSig.body.toString('utf8') },
      }).ok,
    ).toBe(true);
    expect(index.etag).toMatch(/^sha256:/);
  });

  it("records the manifest's minLoadweaver and lists it in the index (2026-11-01)", async () => {
    const { service, packages } = setup();
    const dto = await service.upload(admin, archive('1.3.0', undefined, undefined, 'minLoadweaver: 1.4.0\n'), {
      publish: true,
    });

    expect(dto.minLoadweaver).toBe('1.4.0');
    expect(packages.rows[0].minLoadweaver).toBe('1.4.0');

    await service.upload(admin, archive('1.2.0'), { publish: true });

    const key = await service.publicKey();
    const index = await service.servedIndex();
    const sig = await service.servedIndexSignature();
    const verified = verifyIndex(index.body, { kind: 'blob', signature: sig.body.toString('utf8') }, [key]);
    const versions = verified.ok === true ? verified.value.index.apps[0].versions : [];

    expect(versions.map((v) => [v.version, v.minLoadweaver])).toEqual([
      ['1.3.0', '1.4.0'],
      ['1.2.0', undefined],
    ]);
  });

  it('backfills minLoadweaver of rows uploaded before the column at startup, once, in the background (2026-11-01)', async () => {
    const { service, packages } = setup();
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await service.upload(admin, archive('1.3.0', undefined, undefined, 'minLoadweaver: 1.4.0\n'), { publish: true });
    await service.upload(admin, archive('1.2.0'), { publish: true });

    // Rows from before the column: NULL, plus a corrupt archive (logged, skipped, stays NULL).
    expect(packages.rows.map((r) => r.minLoadweaver)).toEqual(['1.4.0', '']);
    for (const row of packages.rows) row.minLoadweaver = null;
    packages.rows.push({
      ...packages.rows[1],
      id: '00000000-0000-4000-8000-0000000000ff',
      version: '0.9.0',
      archive: Buffer.from('corrupt'),
    });

    const before = await service.list();

    expect(before.map((p) => p.minLoadweaver)).toEqual([null, null, null]);

    await service.onApplicationBootstrap();
    expect(await service.backfill).toEqual({ checked: 2, filled: 1, skipped: 1 });
    expect(packages.rows.map((r) => [r.version, r.minLoadweaver])).toEqual([
      ['1.3.0', '1.4.0'],
      ['1.2.0', ''],
      ['0.9.0', null],
    ]);
    expect(log).toHaveBeenCalledWith('minLoadweaver backfill: 2 package(s) checked, 1 with a minimum, 1 skipped');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('skipped wiki 0.9.0'));

    // The index carries it again; the DTO maps "checked, none" to null.
    const key = await service.publicKey();
    const index = await service.servedIndex();
    const sig = await service.servedIndexSignature();
    const verified = verifyIndex(index.body, { kind: 'blob', signature: sig.body.toString('utf8') }, [key]);
    const versions = verified.ok === true ? verified.value.index.apps[0].versions : [];

    expect(versions.find((v) => v.version === '1.3.0')?.minLoadweaver).toBe('1.4.0');
    expect((await service.list()).map((p) => p.minLoadweaver)).toEqual(['1.4.0', null, null]);

    // Checked rows aren't read again: only the corrupt one is retried.
    packages.update.mockClear();
    expect(await service.backfillMinLoadweaver()).toEqual({ checked: 0, filled: 0, skipped: 1 });
    expect(packages.update).not.toHaveBeenCalled();
    log.mockRestore();
    warn.mockRestore();
  });

  it('reads the backfill in batches and never fails the start', async () => {
    const { service, packages } = setup();

    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    for (let i = 0; i < 12; i++) await service.upload(admin, archive(`1.0.${i}`));
    for (const row of packages.rows) row.minLoadweaver = null;

    expect(await service.backfillMinLoadweaver()).toEqual({ checked: 12, filled: 0, skipped: 0 });
    expect(packages.find.mock.calls.filter(([o]) => (o as { take?: number })?.take === 10)).toHaveLength(2);
    expect(packages.rows.every((r) => r.minLoadweaver === '')).toBe(true);

    packages.find.mockRejectedValueOnce(new Error('db down'));
    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(await service.backfill).toEqual({ checked: 0, filled: 0, skipped: 0 });
    jest.restoreAllMocks();
  });

  it('serves an empty signed index before anything was published and 404s drafts', async () => {
    const { service } = setup();

    await service.upload(admin, archive());

    const index = await service.servedIndex();
    const parsed = parseIndex(index.body);

    expect(parsed.ok === true && parsed.value.apps).toEqual([]);
    await expect(service.servedPackage('wiki', '1.2.0', false)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('unpublishes, deletes unpublished versions only, and lists takedowns in the index', async () => {
    const { service, packages } = setup();

    await service.upload(admin, archive('1.0.0'), { publish: true });
    await service.upload(admin, archive('1.2.0'), { publish: true });

    await expect(service.remove(admin, 'wiki', '1.2.0')).rejects.toBeInstanceOf(ConflictException);

    await service.unpublish(admin, 'wiki', '1.2.0');

    let parsed = parseIndex((await service.servedIndex()).body);

    expect(parsed.ok === true && parsed.value.apps[0].versions.map((v) => v.version)).toEqual(['1.0.0']);

    await service.remove(admin, 'wiki', '1.2.0');
    expect(packages.rows.map((p) => p.version)).toEqual(['1.0.0']);

    await expect(service.takedown(admin, 'wiki', { versions: ['9.9.9'], reason: 'x' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.takedown(admin, 'nope', { reason: 'x' })).rejects.toBeInstanceOf(NotFoundException);

    const takedown = await service.takedown(admin, 'wiki', { reason: 'Security issue' });

    expect(takedown.versions).toBe('all');
    parsed = parseIndex((await service.servedIndex()).body);
    expect(parsed.ok === true && parsed.value.takedowns).toEqual([
      expect.objectContaining({ app: 'wiki', versions: 'all', reason: 'Security issue' }),
    ]);
    expect((await service.list())[0].takenDown).toBe(true);

    await service.liftTakedown(admin, takedown.id);
    parsed = parseIndex((await service.servedIndex()).body);
    expect(parsed.ok === true && parsed.value.takedowns).toEqual([]);
  });
});
