import { createHash, generateKeyPairSync, sign } from 'node:crypto';

import { imagePolicySpecSchema } from '@forepath/loadweaver/shared/util-model';

import {
  applicableImagePolicies,
  blockedFindings,
  runtimeImagePolicy,
  type NamedImagePolicy,
} from './image-policy.service';
import { signatureTag, verifyCosignSignature, type RepositoryReader } from './image-signature';

const digest = `sha256:${'a'.repeat(64)}`;
const keys = () => {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });

  return { publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(), privateKey };
};

/** A repository holding a cosign signature (simple signing) over `signedDigest`, signed with `privateKey`. */
function repository(
  signedDigest: string,
  privateKey: ReturnType<typeof keys>['privateKey'],
  tamper = false,
): RepositoryReader {
  const payload = Buffer.from(
    JSON.stringify({
      critical: {
        identity: { 'docker-reference': 'example/app' },
        image: { 'docker-manifest-digest': signedDigest },
        type: 'cosign container image signature',
      },
      optional: null,
    }),
  );
  const payloadDigest = `sha256:${createHash('sha256').update(payload).digest('hex')}`;
  const signature = sign('sha256', payload, privateKey).toString('base64');

  return {
    manifest: async (reference) =>
      reference === signatureTag(digest)
        ? {
            layers: [
              {
                mediaType: 'application/vnd.dev.cosign.simplesigning.v1+json',
                digest: payloadDigest,
                size: payload.length,
                annotations: { 'dev.cosignproject.cosign/signature': signature },
              },
            ],
          }
        : null,
    blob: async (d) =>
      d === payloadDigest ? (tamper ? Buffer.concat([payload, Buffer.from(' ')]) : payload) : Buffer.alloc(0),
  };
}

describe('cosign signatures', () => {
  it('verifies the signature of the pinned digest with a policy key', async () => {
    const signer = keys();
    const other = keys();

    expect(signatureTag(digest)).toBe(`sha256-${'a'.repeat(64)}.sig`);
    expect(
      await verifyCosignSignature(repository(digest, signer.privateKey), digest, [other.publicPem, signer.publicPem]),
    ).toEqual({
      verified: true,
      key: 1,
    });
    expect(await verifyCosignSignature(repository(digest, signer.privateKey), digest, [other.publicPem])).toEqual({
      verified: false,
      reason: 'no signature verifies with the policy keys',
    });
  });

  it('refuses tampered payloads, signatures of other images and unsigned images', async () => {
    const signer = keys();

    expect(
      await verifyCosignSignature(repository(digest, signer.privateKey, true), digest, [signer.publicPem]),
    ).toMatchObject({
      verified: false,
      reason: 'signature payload does not match its digest',
    });
    expect(
      await verifyCosignSignature(repository(`sha256:${'b'.repeat(64)}`, signer.privateKey), digest, [
        signer.publicPem,
      ]),
    ).toMatchObject({ verified: false, reason: 'signature is for another image' });
    expect(
      await verifyCosignSignature({ manifest: async () => null, blob: async () => Buffer.alloc(0) }, digest, [
        signer.publicPem,
      ]),
    ).toEqual({ verified: false, reason: 'no cosign signature found' });
  });
});

describe('image policies', () => {
  const policy = (name: string, spec: Record<string, unknown>, project?: string): NamedImagePolicy => ({
    name,
    project,
    spec: imagePolicySpecSchema.parse(spec),
  });
  const policies = [
    policy('cluster-critical', { mode: 'monitor', vulnerabilities: { block: ['CRITICAL'] } }),
    policy(
      'shop-high',
      { vulnerabilities: { block: ['HIGH'], ignoreUnfixed: false }, selector: { matchLabels: { tier: 'web' } } },
      'shop',
    ),
    policy('blog', { vulnerabilities: { block: ['LOW'] } }, 'blog'),
  ];

  it('picks policies by project and selector and hands each to the node as its own rule', () => {
    const web = { project: 'shop', service: 'web', labels: { tier: 'web' } };

    expect(applicableImagePolicies(policies, web).map((p) => p.name)).toEqual(['cluster-critical', 'shop-high']);
    // A monitor policy stays monitor next to an enforcing one; settings don't leak between policies.
    expect(runtimeImagePolicy(policies, web)).toEqual([
      { mode: 'monitor', block: ['CRITICAL'], ignoreUnfixed: true },
      { mode: 'enforce', block: ['HIGH'], ignoreUnfixed: false },
    ]);
    expect(runtimeImagePolicy(policies, { project: 'shop', service: 'db', labels: {} })).toEqual([
      { mode: 'monitor', block: ['CRITICAL'], ignoreUnfixed: true },
    ]);
    expect(runtimeImagePolicy(policies, { project: 'other', service: 'x', labels: {} })).toEqual([
      { mode: 'monitor', block: ['CRITICAL'], ignoreUnfixed: true },
    ]);
  });

  it('counts blocked findings, fixable only unless unfixed ones count', () => {
    const scan = {
      summary: {
        counts: {
          CRITICAL: { total: 3, fixable: 1 },
          HIGH: { total: 5, fixable: 0 },
          MEDIUM: { total: 0, fixable: 0 },
          LOW: { total: 9, fixable: 9 },
          UNKNOWN: { total: 0, fixable: 0 },
        },
      },
    };

    expect(blockedFindings(scan, { block: ['CRITICAL', 'HIGH'], ignoreUnfixed: true })).toBe(1);
    expect(blockedFindings(scan, { block: ['CRITICAL', 'HIGH'], ignoreUnfixed: false })).toBe(8);
  });
});
