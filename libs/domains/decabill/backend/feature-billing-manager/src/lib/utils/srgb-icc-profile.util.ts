/**
 * Builds an ICC v2.1 display profile for sRGB (IEC 61966-2-1) used as the PDF/A OutputIntent of Factur-X documents.
 * Matrix/TRC profile: Bradford-adapted (D50) sRGB primaries and a sampled sRGB transfer curve. Generated in code so no
 * binary asset has to be shipped.
 */

const TRC_SAMPLES = 1024;
/** sRGB primaries chromatically adapted to the D50 profile connection space (Bradford). */
const SRGB_D50_PRIMARIES: Readonly<Record<'r' | 'g' | 'b', readonly [number, number, number]>> = {
  r: [0.4360747, 0.2225045, 0.0139322],
  g: [0.3850649, 0.7168786, 0.0971045],
  b: [0.1430804, 0.0606169, 0.7141733],
};
const D50_WHITE: readonly [number, number, number] = [0.9642, 1.0, 0.8249];

export const SRGB_ICC_PROFILE_DESCRIPTION = 'sRGB IEC61966-2.1';

let cachedProfile: Uint8Array | undefined;

export function buildSrgbIccProfile(): Uint8Array {
  if (cachedProfile) {
    return cachedProfile;
  }

  const tags: Array<{ signature: string; data: Uint8Array }> = [
    { signature: 'desc', data: textDescriptionTag(SRGB_ICC_PROFILE_DESCRIPTION) },
    { signature: 'cprt', data: textTag('No copyright, use freely') },
    { signature: 'wtpt', data: xyzTag(D50_WHITE) },
    { signature: 'rXYZ', data: xyzTag(SRGB_D50_PRIMARIES.r) },
    { signature: 'gXYZ', data: xyzTag(SRGB_D50_PRIMARIES.g) },
    { signature: 'bXYZ', data: xyzTag(SRGB_D50_PRIMARIES.b) },
  ];
  const trc = srgbCurveTag();
  const headerSize = 128;
  const tagTableSize = 4 + 12 * (tags.length + 3);
  let offset = align4(headerSize + tagTableSize);
  const entries: Array<{ signature: string; offset: number; size: number }> = [];
  const blocks: Array<{ offset: number; data: Uint8Array }> = [];

  for (const tag of tags) {
    entries.push({ signature: tag.signature, offset, size: tag.data.length });
    blocks.push({ offset, data: tag.data });
    offset = align4(offset + tag.data.length);
  }

  // The three tone curves share one data block (allowed by ICC.1).
  for (const signature of ['rTRC', 'gTRC', 'bTRC']) {
    entries.push({ signature, offset, size: trc.length });
  }

  blocks.push({ offset, data: trc });
  offset = align4(offset + trc.length);

  const profile = new Uint8Array(offset);
  const view = new DataView(profile.buffer);

  // Header
  view.setUint32(0, offset);
  writeAscii(profile, 4, '\0\0\0\0');
  view.setUint32(8, 0x02100000);
  writeAscii(profile, 12, 'mntr');
  writeAscii(profile, 16, 'RGB ');
  writeAscii(profile, 20, 'XYZ ');
  [2026, 1, 1, 0, 0, 0].forEach((value, index) => view.setUint16(24 + index * 2, value));
  writeAscii(profile, 36, 'acsp');
  view.setUint32(64, 0); // perceptual rendering intent
  writeS15Fixed16(view, 68, D50_WHITE[0]);
  writeS15Fixed16(view, 72, D50_WHITE[1]);
  writeS15Fixed16(view, 76, D50_WHITE[2]);

  // Tag table
  view.setUint32(headerSize, entries.length);
  entries.forEach((entry, index) => {
    const base = headerSize + 4 + index * 12;

    writeAscii(profile, base, entry.signature);
    view.setUint32(base + 4, entry.offset);
    view.setUint32(base + 8, entry.size);
  });

  for (const block of blocks) {
    profile.set(block.data, block.offset);
  }

  cachedProfile = profile;

  return profile;
}

function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

function srgbCurveTag(): Uint8Array {
  const data = new Uint8Array(12 + TRC_SAMPLES * 2);
  const view = new DataView(data.buffer);

  writeAscii(data, 0, 'curv');
  view.setUint32(8, TRC_SAMPLES);

  for (let index = 0; index < TRC_SAMPLES; index++) {
    view.setUint16(12 + index * 2, Math.round(srgbToLinear(index / (TRC_SAMPLES - 1)) * 65535));
  }

  return data;
}

function xyzTag([x, y, z]: readonly [number, number, number]): Uint8Array {
  const data = new Uint8Array(20);
  const view = new DataView(data.buffer);

  writeAscii(data, 0, 'XYZ ');
  writeS15Fixed16(view, 8, x);
  writeS15Fixed16(view, 12, y);
  writeS15Fixed16(view, 16, z);

  return data;
}

function textTag(text: string): Uint8Array {
  const data = new Uint8Array(8 + text.length + 1);

  writeAscii(data, 0, 'text');
  writeAscii(data, 8, text);

  return data;
}

/** ICC v2 textDescriptionType: ASCII part, empty Unicode part, empty ScriptCode part (67-byte filler). */
function textDescriptionTag(text: string): Uint8Array {
  const asciiLength = text.length + 1;
  const data = new Uint8Array(12 + asciiLength + 4 + 4 + 2 + 1 + 67);
  const view = new DataView(data.buffer);

  writeAscii(data, 0, 'desc');
  view.setUint32(8, asciiLength);
  writeAscii(data, 12, text);

  return data;
}

function writeAscii(target: Uint8Array, offset: number, text: string): void {
  for (let index = 0; index < text.length; index++) {
    target[offset + index] = text.charCodeAt(index) & 0x7f;
  }
}

function writeS15Fixed16(view: DataView, offset: number, value: number): void {
  view.setInt32(offset, Math.round(value * 65536));
}

function align4(value: number): number {
  return (value + 3) & ~3;
}
