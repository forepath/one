import {
  applyResolvedProvisioningSelectionToConfig,
  collectCustomCloudInitConfigIdsFromPlanDefaults,
  correctOverBackfilledProvisioningOptions,
  encodeProvisioningOptionKey,
  migrateLegacyPlanProviderConfigDefaults,
  normalizePlanProviderConfigDefaults,
  parsePlanProvisioningOptions,
  parseProvisioningOptionKey,
  planHasCustomerProvisioningChoice,
  reconcilePlanProviderConfigDefaults,
  resolveOrderProvisioningSelection,
  resolvePlanProvisioningOptions,
} from './plan-provisioning-options.utils';

describe('planProvisioningOptionsUtils', () => {
  describe('parsePlanProvisioningOptions', () => {
    it('reads explicit provisioningOptions only', () => {
      const options = parsePlanProvisioningOptions({
        provisioningOptions: [
          { type: 'integrated', service: 'controller' },
          { type: 'custom', cloudInitConfigId: 'cfg-1' },
        ],
      });

      expect(options).toEqual([
        { type: 'integrated', service: 'controller' },
        { type: 'custom', cloudInitConfigId: 'cfg-1' },
      ]);
    });

    it('ignores legacy service and cloudInitConfigId fields', () => {
      expect(
        parsePlanProvisioningOptions({
          service: 'custom',
          cloudInitConfigId: 'cfg-legacy',
        }),
      ).toEqual([]);
      expect(parsePlanProvisioningOptions({ service: 'manager' })).toEqual([]);
      expect(parsePlanProvisioningOptions({ cloudInitConfigIds: ['cfg-a', 'cfg-b'] })).toEqual([]);
    });
  });

  describe('migrateLegacyPlanProviderConfigDefaults', () => {
    it('preserves a single legacy integrated controller option', () => {
      const migrated = migrateLegacyPlanProviderConfigDefaults({
        service: 'controller',
        region: 'fsn1',
      });

      expect(migrated?.['provisioningOptions']).toEqual([{ type: 'integrated', service: 'controller' }]);
      expect(migrated?.['service']).toBe('controller');
      expect(migrated?.['region']).toBe('fsn1');
    });

    it('preserves a single legacy integrated manager option', () => {
      const migrated = migrateLegacyPlanProviderConfigDefaults({
        service: 'manager',
        region: 'fsn1',
      });

      expect(migrated?.['provisioningOptions']).toEqual([{ type: 'integrated', service: 'manager' }]);
      expect(migrated?.['service']).toBe('manager');
    });

    it('preserves legacy custom configs without adding integrated options', () => {
      const migrated = migrateLegacyPlanProviderConfigDefaults({
        service: 'custom',
        cloudInitConfigId: 'cfg-legacy',
      });

      expect(migrated?.['provisioningOptions']).toEqual([{ type: 'custom', cloudInitConfigId: 'cfg-legacy' }]);
      expect(migrated?.['service']).toBe('custom');
      expect(migrated?.['cloudInitConfigId']).toBe('cfg-legacy');
    });

    it('skips plans that already have provisioningOptions', () => {
      const defaults = {
        provisioningOptions: [{ type: 'integrated', service: 'manager' }],
        service: 'controller',
      };

      expect(migrateLegacyPlanProviderConfigDefaults(defaults)).toBe(defaults);
    });
  });

  describe('normalizePlanProviderConfigDefaults', () => {
    it('stores provisioningOptions and clears service for multi-option plans', () => {
      const normalized = normalizePlanProviderConfigDefaults({
        service: 'custom',
        cloudInitConfigId: 'cfg-1',
        region: 'fsn1',
        provisioningOptions: [
          { type: 'integrated', service: 'controller' },
          { type: 'custom', cloudInitConfigId: 'cfg-1' },
        ],
      });

      expect(normalized?.['provisioningOptions']).toHaveLength(2);
      expect(normalized?.['service']).toBeUndefined();
      expect(normalized?.['cloudInitConfigId']).toBeUndefined();
      expect(normalized?.['region']).toBe('fsn1');
    });

    it('preserves both integrated options on save without collapsing to one', () => {
      const normalized = normalizePlanProviderConfigDefaults({
        region: 'fsn1',
        provisioningOptions: [
          { type: 'integrated', service: 'controller' },
          { type: 'integrated', service: 'manager' },
        ],
      });

      expect(normalized?.['provisioningOptions']).toEqual([
        { type: 'integrated', service: 'controller' },
        { type: 'integrated', service: 'manager' },
      ]);
      expect(normalized?.['service']).toBeUndefined();
      expect(normalized?.['region']).toBe('fsn1');
    });

    it('preserves integrated and custom options together on save', () => {
      const normalized = normalizePlanProviderConfigDefaults({
        provisioningOptions: [
          { type: 'integrated', service: 'controller' },
          { type: 'integrated', service: 'manager' },
          { type: 'custom', cloudInitConfigId: 'cfg-1' },
        ],
      });

      expect(normalized?.['provisioningOptions']).toEqual([
        { type: 'integrated', service: 'controller' },
        { type: 'integrated', service: 'manager' },
        { type: 'custom', cloudInitConfigId: 'cfg-1' },
      ]);
      expect(normalized?.['service']).toBeUndefined();
      expect(normalized?.['cloudInitConfigId']).toBeUndefined();
    });

    it('keeps derived single integrated service fields', () => {
      const normalized = normalizePlanProviderConfigDefaults({
        region: 'fsn1',
        provisioningOptions: [{ type: 'integrated', service: 'controller' }],
      });

      expect(normalized?.['service']).toBe('controller');
      expect(normalized?.['provisioningOptions']).toEqual([{ type: 'integrated', service: 'controller' }]);
    });

    it('promotes legacy integrated service into provisioningOptions on save', () => {
      const normalized = normalizePlanProviderConfigDefaults({
        service: 'manager',
        cloudInitConfigId: 'cfg-1',
        region: 'fsn1',
      });

      expect(normalized?.['provisioningOptions']).toEqual([{ type: 'integrated', service: 'manager' }]);
      expect(normalized?.['service']).toBe('manager');
      expect(normalized?.['cloudInitConfigId']).toBeUndefined();
      expect(normalized?.['region']).toBe('fsn1');
    });

    it('promotes legacy custom config into provisioningOptions on save', () => {
      const normalized = normalizePlanProviderConfigDefaults({
        service: 'custom',
        cloudInitConfigId: 'cfg-legacy',
        region: 'fsn1',
      });

      expect(normalized?.['provisioningOptions']).toEqual([{ type: 'custom', cloudInitConfigId: 'cfg-legacy' }]);
      expect(normalized?.['service']).toBe('custom');
      expect(normalized?.['cloudInitConfigId']).toBe('cfg-legacy');
    });
  });

  describe('reconcilePlanProviderConfigDefaults', () => {
    it('matches normalize for legacy payloads', () => {
      const defaults = { service: 'manager', region: 'fsn1' };

      expect(reconcilePlanProviderConfigDefaults(defaults)).toEqual(normalizePlanProviderConfigDefaults(defaults));
    });
  });

  describe('resolveOrderProvisioningSelection', () => {
    const multiPlan = {
      provisioningOptions: [
        { type: 'integrated', service: 'controller' },
        { type: 'custom', cloudInitConfigId: 'cfg-1' },
      ],
    };

    it('requires provisioningOptionKey for multi-option plans without legacy service', () => {
      expect(() => resolveOrderProvisioningSelection(multiPlan, {})).toThrow(
        'provisioningOptionKey is required when the plan offers multiple provisioning options',
      );
    });

    it('accepts legacy requested service when it matches a plan option', () => {
      expect(
        resolveOrderProvisioningSelection(multiPlan, {
          service: 'controller',
        }),
      ).toEqual({ service: 'controller' });
    });

    it('accepts provisioningOptionKey for integrated option', () => {
      expect(
        resolveOrderProvisioningSelection(multiPlan, {
          provisioningOptionKey: encodeProvisioningOptionKey({ type: 'integrated', service: 'controller' }),
        }),
      ).toEqual({ service: 'controller' });
    });

    it('accepts provisioningOptionKey for custom option', () => {
      expect(
        resolveOrderProvisioningSelection(multiPlan, {
          provisioningOptionKey: encodeProvisioningOptionKey({ type: 'custom', cloudInitConfigId: 'cfg-1' }),
        }),
      ).toEqual({ service: 'custom', cloudInitConfigId: 'cfg-1' });
    });

    it('rejects option not on plan', () => {
      expect(() =>
        resolveOrderProvisioningSelection(multiPlan, {
          provisioningOptionKey: encodeProvisioningOptionKey({ type: 'integrated', service: 'manager' }),
        }),
      ).toThrow('Provisioning option is not available for this plan');
    });

    it('rejects invalid provisioningOptionKey values', () => {
      expect(() =>
        resolveOrderProvisioningSelection(multiPlan, {
          provisioningOptionKey: 'not-a-valid-key',
        }),
      ).toThrow('Invalid provisioning option');
    });

    it('accepts legacy custom service with cloudInitConfigId in requested config', () => {
      expect(
        resolveOrderProvisioningSelection(multiPlan, {
          service: 'custom',
          cloudInitConfigId: 'cfg-1',
        }),
      ).toEqual({ service: 'custom', cloudInitConfigId: 'cfg-1' });
    });

    it('auto-selects when plan has one explicit option', () => {
      expect(
        resolveOrderProvisioningSelection(
          { provisioningOptions: [{ type: 'custom', cloudInitConfigId: 'cfg-only' }] },
          {},
        ),
      ).toEqual({ service: 'custom', cloudInitConfigId: 'cfg-only' });
    });

    it('resolves legacy service defaults before migration backfill', () => {
      expect(resolveOrderProvisioningSelection({ service: 'manager', region: 'fsn1' }, {})).toEqual({
        service: 'manager',
      });
      expect(resolvePlanProvisioningOptions({ service: 'manager' })).toEqual([
        { type: 'integrated', service: 'manager' },
      ]);
    });

    it('rejects plans without provisioning options when no legacy defaults exist', () => {
      expect(() => resolveOrderProvisioningSelection({ service: 'custom' }, {})).toThrow(
        'Plan has no provisioning options configured',
      );
    });
  });

  describe('parseProvisioningOptionKey', () => {
    it('returns null for empty or unknown keys', () => {
      expect(parseProvisioningOptionKey('')).toBeNull();
      expect(parseProvisioningOptionKey('   ')).toBeNull();
      expect(parseProvisioningOptionKey('unknown:key')).toBeNull();
      expect(parseProvisioningOptionKey('integrated:invalid')).toBeNull();
      expect(parseProvisioningOptionKey('custom:')).toBeNull();
    });

    it('parses integrated and custom keys', () => {
      expect(parseProvisioningOptionKey('integrated:manager')).toEqual({ type: 'integrated', service: 'manager' });
      expect(parseProvisioningOptionKey('custom:cfg-1')).toEqual({ type: 'custom', cloudInitConfigId: 'cfg-1' });
    });
  });

  describe('resolvePlanProvisioningOptions', () => {
    it('defaults to controller when no explicit or legacy options exist', () => {
      expect(resolvePlanProvisioningOptions({ region: 'fsn1' })).toEqual([
        { type: 'integrated', service: 'controller' },
      ]);
    });

    it('collects legacy cloudInitConfigIds array', () => {
      expect(
        resolvePlanProvisioningOptions({
          cloudInitConfigIds: ['cfg-a', ' cfg-b ', 42],
        }),
      ).toEqual([
        { type: 'custom', cloudInitConfigId: 'cfg-a' },
        { type: 'custom', cloudInitConfigId: 'cfg-b' },
      ]);
    });

    it('dedupes explicit provisioning options', () => {
      expect(
        parsePlanProvisioningOptions({
          provisioningOptions: [
            { type: 'integrated', service: 'controller' },
            { type: 'integrated', service: 'controller' },
            { type: 'custom', cloudInitConfigId: 'cfg-1' },
            { type: 'custom', cloudInitConfigId: 'cfg-1' },
            { type: 'integrated', service: 'invalid' },
            null,
          ],
        }),
      ).toEqual([
        { type: 'integrated', service: 'controller' },
        { type: 'custom', cloudInitConfigId: 'cfg-1' },
      ]);
    });
  });

  describe('correctOverBackfilledProvisioningOptions', () => {
    it('collapses dual integrated backfill to legacy manager service', () => {
      const corrected = correctOverBackfilledProvisioningOptions({
        service: 'manager',
        region: 'fsn1',
        provisioningOptions: [
          { type: 'integrated', service: 'controller' },
          { type: 'integrated', service: 'manager' },
        ],
      });

      expect(corrected?.['provisioningOptions']).toEqual([{ type: 'integrated', service: 'manager' }]);
      expect(corrected?.['service']).toBe('manager');
    });

    it('keeps custom options when dual integrated backfill included custom configs', () => {
      const corrected = correctOverBackfilledProvisioningOptions({
        provisioningOptions: [
          { type: 'integrated', service: 'controller' },
          { type: 'integrated', service: 'manager' },
          { type: 'custom', cloudInitConfigId: 'cfg-1' },
        ],
      });

      expect(corrected?.['provisioningOptions']).toEqual([{ type: 'custom', cloudInitConfigId: 'cfg-1' }]);
      expect(corrected?.['service']).toBe('custom');
      expect(corrected?.['cloudInitConfigId']).toBe('cfg-1');
    });

    it('returns undefined when no corrective action is needed', () => {
      expect(
        correctOverBackfilledProvisioningOptions({
          provisioningOptions: [{ type: 'integrated', service: 'manager' }],
          service: 'manager',
        }),
      ).toBeUndefined();
    });

    it('collapses ambiguous dual integrated backfill to controller when service was cleared', () => {
      const corrected = correctOverBackfilledProvisioningOptions({
        region: 'fsn1',
        provisioningOptions: [
          { type: 'integrated', service: 'controller' },
          { type: 'integrated', service: 'manager' },
        ],
      });

      expect(corrected?.['provisioningOptions']).toEqual([{ type: 'integrated', service: 'controller' }]);
      expect(corrected?.['service']).toBe('controller');
    });
  });

  describe('helpers', () => {
    it('encodes and parses option keys', () => {
      const key = encodeProvisioningOptionKey({ type: 'custom', cloudInitConfigId: 'cfg-1' });

      expect(parseProvisioningOptionKey(key)).toEqual({ type: 'custom', cloudInitConfigId: 'cfg-1' });
    });

    it('detects customer choice plans', () => {
      expect(
        planHasCustomerProvisioningChoice({
          provisioningOptions: [
            { type: 'integrated', service: 'controller' },
            { type: 'custom', cloudInitConfigId: 'cfg-1' },
          ],
        }),
      ).toBe(true);
      expect(
        planHasCustomerProvisioningChoice({
          provisioningOptions: [{ type: 'integrated', service: 'controller' }],
        }),
      ).toBe(false);
    });

    it('collects custom config ids from plan defaults', () => {
      expect(
        collectCustomCloudInitConfigIdsFromPlanDefaults({
          provisioningOptions: [
            { type: 'integrated', service: 'manager' },
            { type: 'custom', cloudInitConfigId: 'cfg-1' },
            { type: 'custom', cloudInitConfigId: 'cfg-2' },
          ],
        }),
      ).toEqual(['cfg-1', 'cfg-2']);
    });

    it('applies resolved selection to effective config', () => {
      const effectiveConfig: Record<string, unknown> = {
        provisioningOptions: [{ type: 'integrated', service: 'controller' }],
        provisioningOptionKey: 'integrated:controller',
        region: 'fsn1',
      };

      applyResolvedProvisioningSelectionToConfig(effectiveConfig, {
        service: 'custom',
        cloudInitConfigId: 'cfg-1',
      });

      expect(effectiveConfig).toEqual({
        region: 'fsn1',
        service: 'custom',
        cloudInitConfigId: 'cfg-1',
      });
    });
  });
});
