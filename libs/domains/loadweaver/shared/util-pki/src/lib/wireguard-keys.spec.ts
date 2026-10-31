import { generateWireguardKeyPair, wireguardPublicKey } from './wireguard-keys';

describe('wireguard keys', () => {
  it('generates 32-byte base64 keys whose public part derives from the private part', () => {
    const pair = generateWireguardKeyPair();

    expect(Buffer.from(pair.privateKey, 'base64')).toHaveLength(32);
    expect(Buffer.from(pair.publicKey, 'base64')).toHaveLength(32);
    expect(wireguardPublicKey(pair.privateKey)).toBe(pair.publicKey);
  });

  it('matches the RFC 7748 X25519 test vector', () => {
    const alicePrivate = Buffer.from(
      '77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a',
      'hex',
    ).toString('base64');
    const alicePublic = Buffer.from('8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a', 'hex').toString(
      'base64',
    );

    expect(wireguardPublicKey(alicePrivate)).toBe(alicePublic);
    expect(() => wireguardPublicKey('short')).toThrow('invalid WireGuard private key');
  });
});
