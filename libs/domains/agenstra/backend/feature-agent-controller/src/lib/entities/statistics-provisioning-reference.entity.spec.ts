import { StatisticsProvisioningReferenceEntity } from './statistics-provisioning-reference.entity';

describe('StatisticsProvisioningReferenceEntity', () => {
  it('should create an instance', () => {
    const entity = new StatisticsProvisioningReferenceEntity();

    expect(entity).toBeDefined();
  });

  it('should have all required properties', () => {
    const entity = new StatisticsProvisioningReferenceEntity();

    entity.id = 'stats-prov-uuid';
    entity.originalProvisioningReferenceId = 'prov-uuid';
    entity.statisticsClientId = 'stats-client-uuid';
    entity.providerType = 'hetzner';
    entity.serverId = 'server-123';
    entity.createdAt = new Date();
    entity.updatedAt = new Date();

    expect(entity.id).toBe('stats-prov-uuid');
    expect(entity.originalProvisioningReferenceId).toBe('prov-uuid');
    expect(entity.statisticsClientId).toBe('stats-client-uuid');
    expect(entity.providerType).toBe('hetzner');
    expect(entity.serverId).toBe('server-123');
    expect(entity.createdAt).toBeInstanceOf(Date);
    expect(entity.updatedAt).toBeInstanceOf(Date);
  });

  it('should allow optional serverName, publicIp, privateIp and providerMetadata', () => {
    const entity = new StatisticsProvisioningReferenceEntity();

    entity.serverName = 'test-server';
    entity.publicIp = '1.2.3.4';
    entity.privateIp = '10.0.0.1';
    entity.providerMetadata = JSON.stringify({ location: 'fsn1' });

    expect(entity.serverName).toBe('test-server');
    expect(entity.publicIp).toBe('1.2.3.4');
    expect(entity.privateIp).toBe('10.0.0.1');
    expect(entity.providerMetadata).toBeDefined();
    expect(JSON.parse(entity.providerMetadata!)).toEqual({ location: 'fsn1' });
  });

  it('should allow optional fields to be undefined', () => {
    const entity = new StatisticsProvisioningReferenceEntity();

    entity.id = 'stats-prov-uuid';
    entity.originalProvisioningReferenceId = 'prov-uuid';
    entity.statisticsClientId = 'stats-client-uuid';
    entity.providerType = 'hetzner';
    entity.serverId = 'server-123';

    expect(entity.serverName).toBeUndefined();
    expect(entity.publicIp).toBeUndefined();
    expect(entity.privateIp).toBeUndefined();
    expect(entity.providerMetadata).toBeUndefined();
  });
});
