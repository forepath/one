import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { discoverPatches, parsePatchFileName } from './discover-patches';
import { packageNodeId, patchNodeId } from './schema';

describe('parsePatchFileName', () => {
  it('should parse unscoped and scoped patch-package names', () => {
    expect(parsePatchFileName('lodash+4.17.21.patch')).toEqual({
      fileName: 'lodash+4.17.21.patch',
      packageName: 'lodash',
      packageVersion: '4.17.21',
    });
    expect(parsePatchFileName('@nestjs+common+11.1.6.patch')).toEqual({
      fileName: '@nestjs+common+11.1.6.patch',
      packageName: '@nestjs/common',
      packageVersion: '11.1.6',
    });
  });
});

describe('discoverPatches', () => {
  it('should link patches only to packages already in the graph', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kg-patches-'));
    const patchesDir = path.join(dir, 'patches');
    fs.mkdirSync(patchesDir);
    fs.writeFileSync(path.join(patchesDir, 'lodash+4.17.21.patch'), 'diff');
    fs.writeFileSync(path.join(patchesDir, 'orphan+1.0.0.patch'), 'diff');

    const result = discoverPatches(dir, [
      {
        id: packageNodeId('lodash'),
        type: 'package',
        attrs: { name: 'lodash', version: '4.17.21' },
      },
    ]);

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].id).toBe(patchNodeId('lodash+4.17.21.patch'));
    expect(result.edges).toEqual([
      { from: packageNodeId('lodash'), to: patchNodeId('lodash+4.17.21.patch'), type: 'contains' },
    ]);
  });
});
