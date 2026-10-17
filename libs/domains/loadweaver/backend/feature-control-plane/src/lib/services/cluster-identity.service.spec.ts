import { createPrivateKey, X509Certificate } from 'node:crypto';

import { POSTGRES_TLS_SERVER_NAME } from '@forepath/loadweaver/shared/util-agent-protocol';
import { createCertificateAuthority, verifyCertificate } from '@forepath/loadweaver/shared/util-pki';

import { issuePostgresServerCertificate } from './cluster-identity.service';

describe('Postgres server certificates (3.2)', () => {
  it('carries the name the API checks, the member address and a control-plane identity', async () => {
    const ca = await createCertificateAuthority({ commonName: 'Loadweaver cluster CA lw-abc', validityDays: 3650 });
    const tls = await issuePostgresServerCertificate(ca, 'lw-abc', 'n1', '10.93.0.1');
    const cert = new X509Certificate(tls.certificatePem);

    expect(tls.caCertificatePem).toBe(ca.certificatePem);
    expect(cert.checkHost(POSTGRES_TLS_SERVER_NAME)).toBe(POSTGRES_TLS_SERVER_NAME);
    expect(cert.checkIP('10.93.0.1')).toBe('10.93.0.1');
    expect(cert.checkIP('127.0.0.1')).toBeUndefined();
    expect(cert.checkPrivateKey(createPrivateKey(tls.privateKeyPem))).toBe(true);
    expect(await verifyCertificate(tls.certificatePem, ca.certificatePem)).toMatchObject({
      clusterId: 'lw-abc',
      kind: 'control-plane',
      name: 'postgres/n1',
    });
    // A fresh key with every issue (the agent keeps the certificate it has).
    expect((await issuePostgresServerCertificate(ca, 'lw-abc', 'n1', '10.93.0.1')).privateKeyPem).not.toBe(
      tls.privateKeyPem,
    );
  });
});
