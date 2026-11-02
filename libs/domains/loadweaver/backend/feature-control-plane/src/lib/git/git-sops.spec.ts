import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ageRecipientOf, envelopeEncrypt, generateKey } from '@forepath/loadweaver/shared/util-secrets';
import type { DataSource } from 'typeorm';

import type { GitSopsKeyEntity } from '../entities/git.entity';
import type { AuditLogService } from '../services/audit-log.service';
import { sopsIdentityAad, type MasterKeyService } from '../services/master-key.service';
import { ClusterSopsDecryptor, isSopsFile, UnconfiguredSopsDecryptor } from './git-sops';

/** A file encrypted by the real `sops` 3.13 (util-secrets' known-answer fixtures) and its throwaway identity. */
const FIXTURES = join(__dirname, '../../../../../shared/util-secrets/src/lib/__fixtures__');
const IDENTITY = 'age-secret-key-1spzm5xql9xwhhs9zywypjte5q0z36ffvg7au6lvqn9s79dxgzlzqg0nw8a'.toUpperCase();

function decryptor(options: { row?: Partial<GitSopsKeyEntity> | null; sealed?: boolean; key?: Buffer } = {}) {
  const key = { id: 'k1', value: options.key ?? generateKey() };
  let row: Partial<GitSopsKeyEntity> | null = options.row ?? null;
  const inserts: unknown[][] = [];
  const audit = { record: jest.fn(async () => undefined) };
  const repo = { findOne: async () => row, findOneOrFail: async () => row };
  const dataSource = {
    getRepository: () => repo,
    transaction: async (fn: (m: unknown) => Promise<unknown>) =>
      await fn({
        query: async (_sql: string, params: unknown[]) => {
          inserts.push(params);
          row = {
            id: params[0] as string,
            recipient: params[1] as string,
            keyId: params[2] as string,
            wrappedKey: params[3] as Buffer,
            ciphertext: params[4] as Buffer,
            createdAt: new Date('2026-10-18T10:00:00Z'),
          };

          return [{ id: params[0] }];
        },
      }),
  } as unknown as DataSource;
  const masterKey = {
    current: async () => {
      if (options.sealed) throw new Error('no control-plane member can hold a master-key share yet');

      return key;
    },
  } as unknown as MasterKeyService;

  return {
    svc: new ClusterSopsDecryptor(dataSource, masterKey, audit as unknown as AuditLogService),
    inserts,
    audit,
    key,
  };
}

describe('SOPS seam', () => {
  it('recognizes SOPS-encrypted YAML by its top-level metadata', () => {
    expect(isSopsFile('data: ENC[AES256_GCM,data:x,iv:y,tag:z,type:str]\nsops:\n  version: 3.9.0\n')).toBe(true);
    expect(isSopsFile('apiVersion: loadweaver.com/v1\nkind: Site\nmetadata: { name: a }\nspec: {}\n')).toBe(false);
    expect(isSopsFile('spec:\n  sops:\n    x: 1\n')).toBe(false);
    expect(isSopsFile('sops:\n  - [unclosed\n')).toBe(false);
  });

  it('rejects SOPS files with a clear reason until decryption is configured', async () => {
    const decryptor = new UnconfiguredSopsDecryptor();

    expect(decryptor.configured).toBe(false);
    await expect(decryptor.decrypt('shop/secrets.yaml')).rejects.toThrow(
      'shop/secrets.yaml is SOPS-encrypted, but SOPS decryption is not configured on this cluster',
    );
  });

  it('generates the cluster identity on first need, sealed with the master key, and audits it', async () => {
    const { svc, inserts, audit } = decryptor();
    const { recipient } = await svc.recipient();

    expect(recipient).toMatch(/^age1[0-9a-z]{58}$/);
    expect(inserts).toHaveLength(1);
    // Only the public recipient is stored in clear.
    expect(JSON.stringify(inserts[0])).not.toContain('AGE-SECRET-KEY');
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'git.sops.identity-created', details: expect.objectContaining({ recipient }) }),
    );
    expect((await svc.recipient()).recipient).toBe(recipient);
    expect(inserts).toHaveLength(1);
  });

  it('decrypts files made by the real sops with the stored identity', async () => {
    const value = generateKey();
    const sealed = envelopeEncrypt(value, Buffer.from(IDENTITY), sopsIdentityAad('cluster'));
    const { svc } = decryptor({
      key: value,
      row: { id: 'cluster', recipient: ageRecipientOf(IDENTITY), keyId: 'k1', ...sealed, createdAt: new Date() },
    });
    const yaml = await svc.decrypt('shop/basic.yaml', readFileSync(join(FIXTURES, 'basic.sops.yaml'), 'utf8'));

    expect(yaml).toContain('name: demo');
    expect(yaml).not.toContain('sops:');
    await expect(
      svc.decrypt('shop/x.yaml', 'a: ENC[AES256_GCM,data:x,iv:y,tag:z,type:str]\nsops:\n  age: []\n'),
    ).rejects.toThrow(/^shop\/x\.yaml: sops: /);
  });

  it('fails with a clear reason while the master key is sealed or was rotated meanwhile', async () => {
    await expect(decryptor({ sealed: true }).svc.decrypt('a.yaml', 'x')).rejects.toThrow(
      'a.yaml is SOPS-encrypted: the cluster master key is not available (no control-plane member can hold a master-key share yet)',
    );

    const value = generateKey();
    const sealed = envelopeEncrypt(value, Buffer.from(IDENTITY), sopsIdentityAad('cluster'));

    await expect(
      decryptor({
        key: value,
        row: { id: 'cluster', recipient: 'age1x', keyId: 'old', ...sealed, createdAt: new Date() },
      }).svc.decrypt('a.yaml', 'x'),
    ).rejects.toThrow('wrapped by another master key');
  });
});
