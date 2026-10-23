import {
  isLogin2faRequired,
  isPersonalAccessToken,
  parsePortMapping,
  parseReplica,
  progressLine,
  withPrivateKey,
} from './format.utils';

const jwt = (claims: object) => `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;

describe('cli helpers', () => {
  it('parses port mappings and replicas', () => {
    expect(parsePortMapping('5432')).toEqual({ local: 5432, remote: 5432 });
    expect(parsePortMapping('15432:5432')).toEqual({ local: 15432, remote: 5432 });
    expect(() => parsePortMapping('70000')).toThrow('invalid port mapping');
    expect(parseReplica('shop/store/db')).toBe('shop/store/db/0');
    expect(parseReplica('shop/store/db/2')).toBe('shop/store/db/2');
    expect(() => parseReplica('db')).toThrow('expected project/deployment/service');
  });

  it('prints progress', () => {
    expect(
      progressLine({ id: 'abcdef1234', status: 'applying', progress: { step: 'Applying on n1', percent: 40 } }),
    ).toBe('abcdef12  applying         40 %  Applying on n1');
    expect(progressLine({ id: 'abcdef1234', status: 'pending' })).toBe('abcdef12  pending');
  });

  it('adds the private key to the interface section only', () => {
    expect(withPrivateKey('[Interface]\nAddress = 100.96.0.2/32\n\n[Peer]\nPublicKey = x\n', 'priv')).toBe(
      '[Interface]\nPrivateKey = priv\nAddress = 100.96.0.2/32\n\n[Peer]\nPublicKey = x\n',
    );
    expect(() => withPrivateKey('nothing', 'priv')).toThrow('unexpected');
  });

  it('tells personal access tokens from sessions', () => {
    expect(isPersonalAccessToken(jwt({ sub: 'u1', amr: ['pat'] }))).toBe(true);
    expect(isPersonalAccessToken(jwt({ sub: 'u1', amr: ['pwd'] }))).toBe(false);
    expect(isPersonalAccessToken(jwt({ sub: 'u1' }))).toBe(false);
    expect(isPersonalAccessToken('opaque-token')).toBe(false);
    expect(isPersonalAccessToken('a.not-json.b')).toBe(false);
  });

  it('detects the second-factor challenge by its error code', () => {
    expect(isLogin2faRequired({ message: 'x', code: 'LOGIN_2FA_REQUIRED', method: 'totp' })).toBe(true);
    expect(isLogin2faRequired({ message: '2FA required' })).toBe(false);
    expect(isLogin2faRequired('LOGIN_2FA_REQUIRED')).toBe(false);
    expect(isLogin2faRequired(null)).toBe(false);
  });
});
