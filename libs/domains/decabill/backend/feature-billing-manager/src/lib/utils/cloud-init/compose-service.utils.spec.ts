import { buildComposeBridgeNetwork, buildComposeNamedVolumes, buildHealthyDependsOn } from './compose-service.utils';

describe('compose-service.utils', () => {
  it('builds a healthy depends_on fragment for a compose service', () => {
    expect(buildHealthyDependsOn('postgres')).toBe(`      postgres:
        condition: service_healthy`);
  });

  it('emits named volumes without host binds', () => {
    expect(buildComposeNamedVolumes(['postgres_data', 'redis_data'])).toBe(`volumes:
  postgres_data:
  redis_data:`);
  });

  it('emits a private bridge network', () => {
    expect(buildComposeBridgeNetwork('agent-controller-network')).toBe(`networks:
  agent-controller-network:
    name: agent-controller-network
    driver: bridge`);
  });
});
