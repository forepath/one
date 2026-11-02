import { createCertificateAuthority, createCsr, generateKeyPair, issueCertificate, verifyCertificate } from './pki';
import { signJwtEs256, verifyJwtEs256 } from './jwt';

describe('ES256 JWT with x5c', () => {
  it('signs tokens a verifier can check against the leaf certificate, which chains to the CA', async () => {
    const ca = await createCertificateAuthority({ commonName: 'test CA', validityDays: 1 });
    const keys = await generateKeyPair();
    const cert = await issueCertificate({
      ca,
      csrPem: await createCsr(keys, 'x'),
      clusterId: 'c1',
      kind: 'control-plane',
      name: 'registry-token',
      validityHours: 1,
    });
    const now = Math.floor(Date.now() / 1000);
    const token = signJwtEs256(
      {
        iss: 'cp',
        sub: 'node:n1',
        aud: 'registry',
        iat: now,
        nbf: now - 5,
        exp: now + 300,
        access: [{ type: 'repository', name: 'shop/api', actions: ['pull'] }],
      },
      keys.privateKeyPem,
      cert.certificatePem,
    );
    const verified = verifyJwtEs256(token);

    expect(verified?.claims).toMatchObject({ sub: 'node:n1', access: [{ name: 'shop/api', actions: ['pull'] }] });
    expect(
      await verifyCertificate(
        `-----BEGIN CERTIFICATE-----\n${verified?.header.x5c[0]}\n-----END CERTIFICATE-----`,
        ca.certificatePem,
      ),
    ).toMatchObject({ kind: 'control-plane' });

    // Tampering and expiry are rejected.
    const [h, , s] = token.split('.');

    expect(
      verifyJwtEs256(`${h}.${Buffer.from(JSON.stringify({ sub: 'node:evil' })).toString('base64url')}.${s}`),
    ).toBeNull();
    expect(verifyJwtEs256(token, (now + 301) * 1000)).toBeNull();
  });
});
