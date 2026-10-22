import { DigitalOceanProvider } from './digital-ocean.provider';
import { HetznerProvider } from './hetzner.provider';

type UserDataGenerator = { generateUserDataScript(additionalUserData: string): string };

function decode(userData: string): string {
  return userData.startsWith('#!') ? userData : Buffer.from(userData, 'base64').toString('utf-8');
}

describe('provisioning user data: container isolation (gVisor)', () => {
  const providers: Array<[string, () => UserDataGenerator]> = [
    ['Hetzner', () => new HetznerProvider({} as never) as unknown as UserDataGenerator],
    ['DigitalOcean', () => new DigitalOceanProvider({} as never) as unknown as UserDataGenerator],
  ];

  it.each(providers)('%s installs gVisor after Docker without making it fatal', (_name, create) => {
    const script = decode(create().generateUserDataScript('echo agenstra-additional-user-data'));
    const dockerReady = script.indexOf('Docker is not working properly');
    const gvisor = script.indexOf('if ( agenstra_prepare_gvisor ); then');

    expect(dockerReady).toBeGreaterThan(-1);
    expect(gvisor).toBeGreaterThan(dockerReady);
    expect(script).toContain('--platform=systrap');
    expect(script).toContain('environments use standard Docker (runc)');
    expect(script.indexOf('agenstra-manager-api')).toBeGreaterThan(gvisor);
  });

  it.each(providers)('%s prepares KVM and the sandboxed-kvm runtimes (optional, never fatal)', (_name, create) => {
    const script = decode(create().generateUserDataScript('echo agenstra-additional-user-data'));

    expect(script).toContain('agenstra_gvisor_install || return 1\nif agenstra_kvm_install; then');
    expect(script).toContain('install --runtime="$AGENSTRA_GVISOR_KVM_RUNTIME" -- --platform=kvm');
    expect(script).toContain('--platform=kvm --network=host');
    expect(script).toContain('the sandboxed-kvm level stays unavailable');
  });

  it('keeps room for workspace configuration within the Hetzner limit (applies to the submitted base64 string)', () => {
    const submitted = providers[0][1]().generateUserDataScript('echo agenstra-additional-user-data');

    // Leave at least 8 KiB of the submitted string for the workspace's additional user data.
    expect(submitted.length).toBeLessThan(32 * 1024 - 8 * 1024);
  });

  it('rejects Hetzner user data whose submitted (base64) size exceeds the limit', () => {
    const provider = providers[0][1]();

    // About 26 KiB raw: fits the raw size but not the base64-encoded submission.
    expect(() => provider.generateUserDataScript(`echo ${'x'.repeat(14 * 1024)}`)).toThrow(
      /exceeds Hetzner Cloud limit/,
    );
  });

  it('keeps room for workspace configuration within the DigitalOcean user data limit', () => {
    const script = decode(providers[1][1]().generateUserDataScript('echo agenstra-additional-user-data'));

    expect(Buffer.byteLength(script, 'utf-8')).toBeLessThan(64 * 1024 - 8 * 1024);
  });
});
