import { AuthenticationType, ClientEntity } from '@forepath/identity/backend';

import { ProvisioningReferenceEntity } from './provisioning-reference.entity';

describe('ProvisioningReferenceEntity', () => {
  it('should create an instance', () => {
    const reference = new ProvisioningReferenceEntity();

    expect(reference).toBeDefined();
  });

  it('should have all required properties', () => {
    const client = new ClientEntity();

    client.id = 'client-uuid';
    client.name = 'Test Client';
    client.endpoint = 'https://example.com/api';
    client.authenticationType = AuthenticationType.API_KEY;
    client.createdAt = new Date();
    client.updatedAt = new Date();

    const reference = new ProvisioningReferenceEntity();

    reference.id = 'ref-uuid';
    reference.clientId = 'client-uuid';
    reference.client = client;
    reference.providerType = 'hetzner';
    reference.serverId = 'server-123';
    reference.serverName = 'test-server';
    reference.publicIp = '1.2.3.4';
    reference.privateIp = '10.0.0.1';
    reference.providerMetadata = JSON.stringify({ location: 'fsn1', datacenter: 'fsn1-dc8' });
    reference.createdAt = new Date();
    reference.updatedAt = new Date();

    expect(reference.id).toBe('ref-uuid');
    expect(reference.clientId).toBe('client-uuid');
    expect(reference.client).toBe(client);
    expect(reference.providerType).toBe('hetzner');
    expect(reference.serverId).toBe('server-123');
    expect(reference.serverName).toBe('test-server');
    expect(reference.publicIp).toBe('1.2.3.4');
    expect(reference.privateIp).toBe('10.0.0.1');
    expect(reference.providerMetadata).toBe(JSON.stringify({ location: 'fsn1', datacenter: 'fsn1-dc8' }));
    expect(reference.createdAt).toBeInstanceOf(Date);
    expect(reference.updatedAt).toBeInstanceOf(Date);
  });

  it('should allow optional properties', () => {
    const reference = new ProvisioningReferenceEntity();

    reference.id = 'ref-uuid';
    reference.clientId = 'client-uuid';
    reference.providerType = 'hetzner';
    reference.serverId = 'server-123';
    reference.createdAt = new Date();
    reference.updatedAt = new Date();

    expect(reference.serverName).toBeUndefined();
    expect(reference.publicIp).toBeUndefined();
    expect(reference.privateIp).toBeUndefined();
    expect(reference.providerMetadata).toBeUndefined();
  });

  it('should support different provider types', () => {
    const reference = new ProvisioningReferenceEntity();

    reference.id = 'ref-uuid';
    reference.clientId = 'client-uuid';
    reference.providerType = 'aws';
    reference.serverId = 'i-1234567890abcdef0';
    reference.createdAt = new Date();
    reference.updatedAt = new Date();

    expect(reference.providerType).toBe('aws');
    expect(reference.serverId).toBe('i-1234567890abcdef0');
  });

  it('should handle encrypted provider metadata', () => {
    const reference = new ProvisioningReferenceEntity();

    reference.id = 'ref-uuid';
    reference.clientId = 'client-uuid';
    reference.providerType = 'hetzner';
    reference.serverId = 'server-123';
    // Metadata is encrypted at rest via transformer
    reference.providerMetadata = 'encrypted-metadata-string';
    reference.createdAt = new Date();
    reference.updatedAt = new Date();

    expect(reference.providerMetadata).toBe('encrypted-metadata-string');
  });
});
