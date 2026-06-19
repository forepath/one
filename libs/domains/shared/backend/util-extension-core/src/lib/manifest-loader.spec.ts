import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  DEFAULT_EXTENSION_VERSION,
  loadExtensionManifestFromFile,
  normalizeForepathExtensionManifest,
  validateForepathExtensionManifest,
} from './manifest-loader';

describe('manifest-loader', () => {
  it('applies default version 0.0.0 when version is missing', () => {
    const manifest = normalizeForepathExtensionManifest({
      id: 'stripe',
      kind: 'payment-processor',
      name: 'Stripe',
      description: 'Stripe payments',
    });

    expect(manifest.version).toBe(DEFAULT_EXTENSION_VERSION);
  });

  it('validates required manifest fields', () => {
    expect(() =>
      validateForepathExtensionManifest({
        id: 'stripe',
        kind: 'payment-processor',
        name: 'Stripe',
        description: 'Stripe payments',
        version: '0.0.0',
      }),
    ).not.toThrow();
  });

  it('loads manifest from file', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forepath-manifest-'));
    const manifestPath = path.join(tempDir, 'forepath.extension.json');

    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        id: 'demo',
        kind: 'agent-provider',
        name: 'Demo',
        description: 'Demo provider',
      }),
    );

    const manifest = loadExtensionManifestFromFile(manifestPath);

    expect(manifest.id).toBe('demo');
    expect(manifest.version).toBe('0.0.0');
  });
});
