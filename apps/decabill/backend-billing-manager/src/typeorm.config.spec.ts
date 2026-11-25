import * as billing from '@forepath/decabill/backend';
import { getMetadataArgsStorage } from 'typeorm';

import { typeormConfig } from './typeorm.config';

describe('typeormConfig', () => {
  it('registers every entity the billing library exports (missing ones fail at runtime with "No metadata")', () => {
    const registered = new Set(typeormConfig.entities as unknown[]);
    const exported = new Set<unknown>(Object.values(billing));
    const missing = getMetadataArgsStorage()
      .tables.filter((table) => typeof table.target === 'function' && exported.has(table.target))
      .filter((table) => !registered.has(table.target))
      .map((table) => (table.target as { name: string }).name);

    expect(missing).toEqual([]);
  });
});
