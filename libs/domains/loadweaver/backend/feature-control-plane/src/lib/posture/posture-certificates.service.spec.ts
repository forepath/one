import 'reflect-metadata';

import { webcrypto } from 'node:crypto';

import { postureProofMessage } from '@forepath/loadweaver/shared/util-model';
import {
  createCertificateAuthority,
  createCsr,
  generateKeyPair,
  issueCertificate,
  type CertificateAuthority,
  type PemKeyPair,
} from '@forepath/loadweaver/shared/util-pki';
import { BadRequestException } from '@nestjs/common';
import * as x509 from '@peculiar/x509';

import { PostureCertificateTrustEntity } from '../entities/posture-integration.entity';
import { PostureCertificatesService } from './posture-certificates.service';

const crypto = webcrypto as unknown as Crypto;
const EC = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' } as const;
const CLIENT = '0b8f7c38-4c55-4a52-9f3e-6a0d1fd4a001';

async function sign(keys: PemKeyPair, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('pkcs8', x509.PemConverter.decode(keys.privateKeyPem)[0], EC, false, [
    'sign',
  ]);

  return Buffer.from(await crypto.subtle.sign(EC, key, new TextEncoder().encode(message))).toString('base64');
}

async function issue(ca: CertificateAuthority, name: string, keys: PemKeyPair) {
  return await issueCertificate({
    ca,
    csrPem: await createCsr(keys, 'device'),
    clusterId: 'lab',
    kind: 'client',
    name,
    validityHours: 720,
  });
}

function setup(trust: Partial<PostureCertificateTrustEntity> | null, clusterCa: CertificateAuthority) {
  const saved: PostureCertificateTrustEntity[] = [];
  const repo = {
    findOne: jest.fn(async () =>
      trust
        ? Object.assign(new PostureCertificateTrustEntity(), {
            id: 'default',
            trustClusterCa: true,
            requireProof: true,
            companyCaPem: null,
            crlPem: null,
            ...trust,
          })
        : null,
    ),
    save: jest.fn(async (v: PostureCertificateTrustEntity) => saved.push(v)),
  };
  const dataSource = {
    getRepository: () => repo,
    transaction: async (cb: (m: unknown) => unknown) => await cb({ getRepository: () => repo }),
  };
  const identity = { caCertificate: jest.fn(async () => clusterCa.certificatePem) };
  const service = new PostureCertificatesService(
    dataSource as never,
    { assert: jest.fn(async () => ({})) } as never,
    { record: jest.fn(), recordStandalone: jest.fn() } as never,
    identity as never,
  );

  return { service, saved };
}

describe('PostureCertificatesService', () => {
  let clusterCa: CertificateAuthority;
  let companyCa: CertificateAuthority;
  let keys: PemKeyPair;

  beforeAll(async () => {
    clusterCa = await createCertificateAuthority({ commonName: 'Loadweaver cluster CA', validityDays: 365 });
    companyCa = await createCertificateAuthority({ commonName: 'Example Corp Device CA', validityDays: 365 });
    keys = await generateKeyPair();
  });

  it('accepts a cluster-issued certificate for this device with a fresh proof of possession', async () => {
    const issued = await issue(clusterCa, CLIENT, keys);
    const { service } = setup(null, clusterCa);
    const timestamp = new Date().toISOString();
    const fact = await service.verifyReport(
      { id: CLIENT, certificateSerial: issued.serialNumber },
      {
        pem: issued.certificatePem,
        proof: { timestamp, signature: await sign(keys, postureProofMessage(CLIENT, timestamp)) },
      },
    );

    expect(fact).toMatchObject({
      source: 'loadweaver',
      valid: true,
      revoked: false,
      serialNumber: issued.serialNumber,
      reasons: [],
    });
  });

  it('rejects another device’s certificate, superseded serials, missing and stale proofs', async () => {
    const other = await issue(clusterCa, '1b8f7c38-4c55-4a52-9f3e-6a0d1fd4a002', keys);
    const own = await issue(clusterCa, CLIENT, keys);
    const { service } = setup(null, clusterCa);
    const timestamp = new Date().toISOString();
    const proof = { timestamp, signature: await sign(keys, postureProofMessage(CLIENT, timestamp)) };

    expect(
      (
        await service.verifyReport(
          { id: CLIENT, certificateSerial: other.serialNumber },
          { pem: other.certificatePem, proof },
        )
      ).reasons,
    ).toContain('the device certificate belongs to another device');
    expect(
      await service.verifyReport({ id: CLIENT, certificateSerial: 'newer' }, { pem: own.certificatePem, proof }),
    ).toMatchObject({
      valid: false,
      revoked: true,
    });
    expect(
      (await service.verifyReport({ id: CLIENT, certificateSerial: own.serialNumber }, { pem: own.certificatePem }))
        .reasons,
    ).toEqual(['no proof of possession for the device certificate']);

    const old = new Date(Date.now() - 10 * 60_000).toISOString();

    expect(
      (
        await service.verifyReport(
          { id: CLIENT, certificateSerial: own.serialNumber },
          {
            pem: own.certificatePem,
            proof: { timestamp: old, signature: await sign(keys, postureProofMessage(CLIENT, old)) },
          },
        )
      ).reasons,
    ).toEqual(['the proof of possession is outside the 5-minute window']);
  });

  it('verifies company CA certificates when configured', async () => {
    const company = await issue(companyCa, 'laptop-17', keys);
    const timestamp = new Date().toISOString();
    const proof = { timestamp, signature: await sign(keys, postureProofMessage(CLIENT, timestamp)) };

    expect(
      await setup({ companyCaPem: companyCa.certificatePem }, clusterCa).service.verifyReport(
        { id: CLIENT, certificateSerial: null },
        { pem: company.certificatePem, proof },
      ),
    ).toMatchObject({ source: 'company', valid: true });
    expect(
      (
        await setup(null, clusterCa).service.verifyReport(
          { id: CLIENT, certificateSerial: null },
          { pem: company.certificatePem, proof },
        )
      ).reasons,
    ).toEqual(['the device certificate is not issued by a trusted CA']);
  });

  it('validates trust settings (CA certificates only)', async () => {
    const { service, saved } = setup(null, clusterCa);
    const leaf = await issue(companyCa, 'x', keys);

    await expect(service.updateSettings(undefined, { companyCaPem: leaf.certificatePem })).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.updateSettings(undefined, { crlPem: 'garbage' })).rejects.toThrow(/CRL/);

    await service.updateSettings(undefined, { companyCaPem: companyCa.certificatePem, requireProof: false });

    expect(saved[0]).toMatchObject({
      companyCaPem: companyCa.certificatePem,
      requireProof: false,
      trustClusterCa: true,
    });
  });
});
