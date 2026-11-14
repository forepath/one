import {
  buildProvisioningOptionsFromKeys,
  DEFAULT_INTEGRATED_PROVISIONING_OPTION_KEYS,
  encodeProvisioningOptionKey,
  integratedProvisioningServiceLabel,
  NO_PROVISIONING_OPTION_KEY,
  parsePlanProvisioningOptions,
  parseProvisioningOptionKey,
  planProvisioningOptionKeysFromDefaults,
} from './plan-provisioning-options.utils';

describe('planProvisioningOptionsUtils', () => {
  it('exposes default integrated option keys', () => {
    expect(DEFAULT_INTEGRATED_PROVISIONING_OPTION_KEYS).toEqual([
      'integrated:agenstra-controller',
      'integrated:agenstra-manager',
      'integrated:decabill-billing',
    ]);
  });

  it('integratedProvisioningServiceLabel returns stack names', () => {
    expect(integratedProvisioningServiceLabel('agenstra-controller')).toBe('Agenstra Controller');
    expect(integratedProvisioningServiceLabel('agenstra-manager')).toBe('Agenstra Manager');
    expect(integratedProvisioningServiceLabel('decabill-billing')).toBe('Decabill Billing');
  });

  it('encodes integrated and custom option keys', () => {
    expect(encodeProvisioningOptionKey({ type: 'integrated', service: 'agenstra-controller' })).toBe(
      'integrated:agenstra-controller',
    );
    expect(encodeProvisioningOptionKey({ type: 'custom', cloudInitConfigId: 'cfg-1' })).toBe('custom:cfg-1');
  });

  it('parses plan defaults with provisioningOptions only', () => {
    expect(
      parsePlanProvisioningOptions({
        provisioningOptions: [
          { type: 'integrated', service: 'agenstra-manager' },
          { type: 'custom', cloudInitConfigId: 'cfg-1' },
        ],
      }),
    ).toEqual([
      { type: 'integrated', service: 'agenstra-manager' },
      { type: 'custom', cloudInitConfigId: 'cfg-1' },
    ]);
    expect(
      parsePlanProvisioningOptions({
        service: 'custom',
        cloudInitConfigId: 'cfg-legacy',
      }),
    ).toEqual([]);
  });

  it('builds keys from defaults and round-trips selected keys', () => {
    const defaults = {
      provisioningOptions: [{ type: 'custom', cloudInitConfigId: 'cfg-legacy' }],
    };

    expect(planProvisioningOptionKeysFromDefaults(defaults)).toEqual(['custom:cfg-legacy']);
    expect(buildProvisioningOptionsFromKeys(['integrated:agenstra-controller', 'custom:cfg-1'])).toEqual([
      { type: 'integrated', service: 'agenstra-controller' },
      { type: 'custom', cloudInitConfigId: 'cfg-1' },
    ]);
  });

  it('infers legacy integrated service keys when provisioningOptions are absent', () => {
    expect(planProvisioningOptionKeysFromDefaults({ service: 'agenstra-manager' })).toEqual([
      'integrated:agenstra-manager',
    ]);
    expect(planProvisioningOptionKeysFromDefaults({ service: 'manager' })).toEqual(['integrated:agenstra-manager']);
    expect(planProvisioningOptionKeysFromDefaults({ service: 'controller' })).toEqual([
      'integrated:agenstra-controller',
    ]);
    expect(planProvisioningOptionKeysFromDefaults({ service: 'custom', cloudInitConfigId: 'cfg-legacy' })).toEqual([
      'custom:cfg-legacy',
    ]);
    expect(planProvisioningOptionKeysFromDefaults({ region: 'fsn1' })).toEqual(['integrated:agenstra-controller']);
  });

  it('maps legacy integrated option keys to canonical service ids', () => {
    expect(parseProvisioningOptionKey('integrated:controller')).toEqual({
      type: 'integrated',
      service: 'agenstra-controller',
    });
    expect(parseProvisioningOptionKey('integrated:manager')).toEqual({
      type: 'integrated',
      service: 'agenstra-manager',
    });
    expect(
      parsePlanProvisioningOptions({
        provisioningOptions: [{ type: 'integrated', service: 'controller' }],
      }),
    ).toEqual([{ type: 'integrated', service: 'agenstra-controller' }]);
  });

  it('parses invalid provisioning option keys safely', () => {
    expect(parseProvisioningOptionKey('')).toBeNull();
    expect(parseProvisioningOptionKey('integrated:invalid')).toBeNull();
    expect(buildProvisioningOptionsFromKeys(['integrated:agenstra-controller', 'bad-key', 'custom:cfg-1'])).toEqual([
      { type: 'integrated', service: 'agenstra-controller' },
      { type: 'custom', cloudInitConfigId: 'cfg-1' },
    ]);
  });

  it('round-trips the no-provisioning (bare server) option', () => {
    expect(NO_PROVISIONING_OPTION_KEY).toBe('none');
    expect(encodeProvisioningOptionKey({ type: 'none' })).toBe('none');
    expect(parseProvisioningOptionKey('none')).toEqual({ type: 'none' });
    expect(buildProvisioningOptionsFromKeys(['none', 'integrated:agenstra-controller'])).toEqual([
      { type: 'none' },
      { type: 'integrated', service: 'agenstra-controller' },
    ]);
  });

  it('reads none from plan defaults without falling back to agenstra-controller', () => {
    expect(parsePlanProvisioningOptions({ provisioningOptions: [{ type: 'none' }] })).toEqual([{ type: 'none' }]);
    expect(planProvisioningOptionKeysFromDefaults({ provisioningOptions: [{ type: 'none' }] })).toEqual(['none']);
    expect(planProvisioningOptionKeysFromDefaults({ service: 'none' })).toEqual(['none']);
  });
});
