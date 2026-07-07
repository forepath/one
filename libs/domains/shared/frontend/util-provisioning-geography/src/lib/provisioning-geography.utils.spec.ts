import { formatProvisioningLocationLabel, providerLocationCatalogFromList } from './provisioning-geography.utils';

describe('provisioning geography utils', () => {
  it('should format label from catalog map', () => {
    const catalog = providerLocationCatalogFromList([{ id: 'fsn1', name: 'Falkenstein' }]);

    expect(formatProvisioningLocationLabel('fsn1', catalog)).toBe('Falkenstein');
  });

  it('should fall back to slug when catalog misses entry', () => {
    expect(formatProvisioningLocationLabel('unknown', [])).toBe('unknown');
  });
});
