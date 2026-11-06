import { parsePemList, readSamlServiceProviderConfig } from './saml.config';

const CERT_BODY = 'MIIBszCCAVmgAwIBAgIUQ'.padEnd(120, 'A');

describe('readSamlServiceProviderConfig', () => {
  const base = {
    SAML_IDP_SSO_URL: 'https://idp.example.com/realms/test/protocol/saml',
    SAML_IDP_CERT: CERT_BODY,
    SAML_SP_ACS_URL: 'https://console.example.com/api/auth/saml/acs',
    SAML_FRONTEND_CALLBACK_URL: 'https://console.example.com/login/saml/callback',
  };

  it('applies secure defaults', () => {
    const config = readSamlServiceProviderConfig({ ...base });

    expect(config.spEntityId).toBe('https://console.example.com');
    expect(config.wantAssertionsSigned).toBe(true);
    expect(config.wantAuthnResponseSigned).toBe(true);
    expect(config.nameIdFormat).toBe('urn:oasis:names:tc:SAML:2.0:nameid-format:persistent');
    expect(config.validateInResponseTo).toBe('always');
    expect(config.acceptedClockSkewMs).toBe(0);
    expect(config.idpCerts[0]).toMatch(/^-----BEGIN CERTIFICATE-----\n/);
  });

  it.each(['SAML_IDP_SSO_URL', 'SAML_SP_ACS_URL', 'SAML_FRONTEND_CALLBACK_URL', 'SAML_IDP_CERT'])(
    'requires %s',
    (key) => {
      expect(() => readSamlServiceProviderConfig({ ...base, [key]: '' })).toThrow(new RegExp(key));
    },
  );

  it('refuses to accept unsigned messages', () => {
    expect(() =>
      readSamlServiceProviderConfig({
        ...base,
        SAML_WANT_ASSERTIONS_SIGNED: 'false',
        SAML_WANT_RESPONSE_SIGNED: 'false',
      }),
    ).toThrow(/must not both be false/);
    expect(
      readSamlServiceProviderConfig({ ...base, SAML_WANT_ASSERTIONS_SIGNED: 'false' }).wantAuthnResponseSigned,
    ).toBe(true);
  });

  it('rejects non-http URLs', () => {
    expect(() => readSamlServiceProviderConfig({ ...base, SAML_SP_ACS_URL: 'javascript:alert(1)' })).toThrow();
  });

  it('caps the clock skew', () => {
    expect(readSamlServiceProviderConfig({ ...base, SAML_CLOCK_SKEW_MS: '99999999' }).acceptedClockSkewMs).toBe(
      300_000,
    );
  });
});

describe('parsePemList', () => {
  it('accepts PEM blocks (with literal \\n), several certificates and bare base64 bodies', () => {
    const pem = `-----BEGIN CERTIFICATE-----\\n${CERT_BODY}\\n-----END CERTIFICATE-----`;

    expect(parsePemList(pem, 'CERTIFICATE')).toHaveLength(1);
    expect(parsePemList(`${pem}\n${pem}`, 'CERTIFICATE')).toHaveLength(2);
    expect(parsePemList(`${CERT_BODY} ${CERT_BODY}`, 'CERTIFICATE')).toHaveLength(2);
  });

  it('rejects non-base64 garbage', () => {
    expect(() => parsePemList('<xml/>', 'CERTIFICATE')).toThrow();
  });
});
