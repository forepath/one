import { ProviderRegistryService } from './provider-registry.service';

describe('ProviderRegistryService', () => {
  let service: ProviderRegistryService;

  beforeEach(() => {
    service = new ProviderRegistryService();
  });

  it('should return empty array when no providers registered', () => {
    expect(service.getProviders()).toEqual([]);
  });

  it('should return registered providers', () => {
    service.register({ id: 'hetzner', displayName: 'Hetzner Cloud', configSchema: { required: ['location'] } });
    expect(service.getProviders()).toEqual([
      { id: 'hetzner', displayName: 'Hetzner Cloud', configSchema: { required: ['location'] } },
    ]);
  });

  it('should return provider with configSchema containing enum for pre-defined values', () => {
    const configSchema = {
      required: ['serverType', 'location'],
      properties: {
        serverType: { type: 'string', description: 'Server type', enum: ['cax11', 'cpx11'] },
        location: { type: 'string', description: 'Location', enum: ['fsn1', 'nbg1'] },
      },
    };

    service.register({ id: 'hetzner', displayName: 'Hetzner Cloud', configSchema });
    const providers = service.getProviders();

    expect(providers).toHaveLength(1);
    expect(providers[0].configSchema).toEqual(configSchema);
    const props = (providers[0].configSchema as { properties?: Record<string, unknown> })?.properties ?? {};

    expect((props.serverType as { enum?: string[] })?.enum).toEqual(['cax11', 'cpx11']);
    expect((props.location as { enum?: string[] })?.enum).toEqual(['fsn1', 'nbg1']);
  });

  it('should overwrite when registering same id twice', () => {
    service.register({ id: 'hetzner', displayName: 'Hetzner Cloud' });
    service.register({ id: 'hetzner', displayName: 'Hetzner Cloud v2' });
    expect(service.getProviders()).toEqual([{ id: 'hetzner', displayName: 'Hetzner Cloud v2' }]);
  });

  it('hasProvider returns false for unregistered id', () => {
    expect(service.hasProvider('unknown')).toBe(false);
  });

  it('hasProvider returns true after register', () => {
    service.register({ id: 'hetzner', displayName: 'Hetzner Cloud' });
    expect(service.hasProvider('hetzner')).toBe(true);
  });
});
