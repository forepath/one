import { buildSrgbIccProfile } from './srgb-icc-profile.util';

describe('buildSrgbIccProfile', () => {
  const profile = buildSrgbIccProfile();
  const view = new DataView(profile.buffer, profile.byteOffset, profile.byteLength);
  const ascii = (offset: number, length = 4) => String.fromCharCode(...profile.slice(offset, offset + length));

  it('writes a valid ICC v2 RGB display profile header', () => {
    expect(view.getUint32(0)).toBe(profile.length);
    expect(profile.length % 4).toBe(0);
    expect(view.getUint32(8)).toBe(0x02100000);
    expect(ascii(12)).toBe('mntr');
    expect(ascii(16)).toBe('RGB ');
    expect(ascii(20)).toBe('XYZ ');
    expect(ascii(36)).toBe('acsp');
  });

  it('contains the required matrix/TRC tags within bounds', () => {
    const count = view.getUint32(128);
    const tags = new Map<string, { offset: number; size: number }>();

    for (let index = 0; index < count; index++) {
      const base = 132 + index * 12;

      tags.set(ascii(base), { offset: view.getUint32(base + 4), size: view.getUint32(base + 8) });
    }

    for (const signature of ['desc', 'cprt', 'wtpt', 'rXYZ', 'gXYZ', 'bXYZ', 'rTRC', 'gTRC', 'bTRC']) {
      const tag = tags.get(signature);

      expect(tag).toBeDefined();
      expect(tag!.offset + tag!.size).toBeLessThanOrEqual(profile.length);
    }

    const trc = tags.get('rTRC')!;

    expect(ascii(trc.offset)).toBe('curv');
    expect(view.getUint16(trc.offset + 12)).toBe(0);
    expect(view.getUint16(trc.offset + trc.size - 2)).toBe(65535);
  });
});
