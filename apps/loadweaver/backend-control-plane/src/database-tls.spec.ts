import type { PeerCertificate } from 'node:tls';

import { databaseSsl, databaseSslMode } from './database-tls';

const CA = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n';

function peer(subjectaltname: string): PeerCertificate {
  return { subject: { CN: 'control-plane:postgres/n1' }, subjectaltname } as unknown as PeerCertificate;
}

describe('database TLS', () => {
  it('verifies by default in production and is off elsewhere', () => {
    expect(databaseSslMode({ NODE_ENV: 'production' })).toBe('verify-full');
    expect(databaseSslMode({ NODE_ENV: 'development' })).toBe('disable');
    expect(databaseSslMode({ NODE_ENV: 'test' })).toBe('disable');
    expect(databaseSslMode({ NODE_ENV: 'production', DB_SSL_MODE: ' Require ' })).toBe('require');
    expect(() => databaseSslMode({ DB_SSL_MODE: 'prefer' })).toThrow(/DB_SSL_MODE must be one of/);
  });

  it('disables TLS or encrypts without verification on request', () => {
    expect(databaseSsl({ NODE_ENV: 'production', DB_SSL_MODE: 'disable' })).toBe(false);
    expect(databaseSsl({ DB_SSL_MODE: 'require' })).toEqual({ rejectUnauthorized: false });
  });

  it('refuses verify-full without a CA', () => {
    expect(() => databaseSsl({ NODE_ENV: 'production' })).toThrow(/needs the CA certificate/);
    expect(() => databaseSsl({ DB_SSL_MODE: 'verify-full', DB_SSL_CA: 'not a pem' })).toThrow(/needs the CA/);
  });

  it('takes the CA inline or from a file and checks the configured server name', () => {
    const inline = databaseSsl({ DB_SSL_MODE: 'verify-full', DB_SSL_CA: CA, DB_SSL_SERVERNAME: 'postgres.loadweaver' });

    expect(inline).toMatchObject({ ca: CA, rejectUnauthorized: true, servername: 'postgres.loadweaver' });

    const read = jest.fn(() => CA);

    expect(databaseSsl({ DB_SSL_MODE: 'verify-full', DB_SSL_CA_FILE: '/etc/lw/ca.pem' }, read)).toEqual({
      ca: CA,
      rejectUnauthorized: true,
    });
    expect(read).toHaveBeenCalledWith('/etc/lw/ca.pem');

    // The name is checked whatever host the driver connected to (the leader proxy on 127.0.0.1).
    const check = (inline as { checkServerIdentity: (host: string, cert: PeerCertificate) => Error | undefined })
      .checkServerIdentity;

    expect(
      check(
        '127.0.0.1',
        peer('URI:spiffe://lw-1.loadweaver/control-plane/postgres/n1, DNS:postgres.loadweaver, IP Address:10.93.0.1'),
      ),
    ).toBeUndefined();
    expect(check('127.0.0.1', peer('DNS:api.example.com, IP Address:127.0.0.1'))?.message).toMatch(
      /postgres.loadweaver/,
    );
  });
});
