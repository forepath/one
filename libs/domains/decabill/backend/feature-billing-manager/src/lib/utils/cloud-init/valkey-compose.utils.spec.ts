import {
  VALKEY_COMPOSE_DEPENDS_ON,
  VALKEY_COMPOSE_IMAGE,
  buildValkeyBackendEnvLines,
  buildValkeyComposeService,
} from './valkey-compose.utils';

describe('valkey-compose.utils', () => {
  describe('buildValkeyBackendEnvLines', () => {
    it('points backends at the compose Valkey service with the given key prefix', () => {
      expect(buildValkeyBackendEnvLines('decabill-billing')).toEqual([
        'VALKEY_HOST: valkey',
        'VALKEY_PORT: 6379',
        'VALKEY_PASSWORD: ',
        'VALKEY_DB: 0',
        'VALKEY_KEY_PREFIX: decabill-billing',
        'CACHE_CLIENT: glide',
      ]);
    });
  });

  describe('buildValkeyComposeService', () => {
    it('emits AOF Valkey without publishing host ports', () => {
      const yaml = buildValkeyComposeService({
        containerName: 'agent-controller-valkey',
        network: 'agent-controller-network',
      });

      expect(yaml).toContain(`image: ${VALKEY_COMPOSE_IMAGE}`);
      expect(yaml).toContain('container_name: agent-controller-valkey');
      expect(yaml).toContain("command: ['valkey-server', '--appendonly', 'yes']");
      expect(yaml).toContain("test: ['CMD', 'valkey-cli', 'ping']");
      expect(yaml).toContain('valkey_data:/data');
      expect(yaml).not.toContain('ports:');
    });
  });

  it('pins the Valkey image by digest', () => {
    expect(VALKEY_COMPOSE_IMAGE).toMatch(/^docker\.io\/valkey\/valkey:[^@]+@sha256:[0-9a-f]{64}$/);
  });

  it('exports a compose depends_on fragment for healthy Valkey', () => {
    expect(VALKEY_COMPOSE_DEPENDS_ON).toContain('valkey:');
    expect(VALKEY_COMPOSE_DEPENDS_ON).toContain('condition: service_healthy');
  });
});
