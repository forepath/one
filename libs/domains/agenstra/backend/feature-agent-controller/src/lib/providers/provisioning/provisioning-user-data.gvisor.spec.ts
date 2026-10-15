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
});
