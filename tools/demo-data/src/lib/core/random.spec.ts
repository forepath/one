import { DEMO_ID_PREFIX, isDemoId } from './demo-ids';
import { DemoRandom, slugify } from './random';

describe('DemoRandom', () => {
  const now = new Date('2026-10-06T12:00:00.000Z');

  it('should be deterministic for the same seed', () => {
    const a = new DemoRandom(42, now);
    const b = new DemoRandom(42, now);

    expect(Array.from({ length: 5 }, () => a.next())).toEqual(Array.from({ length: 5 }, () => b.next()));
  });

  it('should create v4-shaped ids with the demo prefix', () => {
    const id = new DemoRandom(1, now).id();

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(id.startsWith(DEMO_ID_PREFIX)).toBe(true);
    expect(isDemoId(id)).toBe(true);
  });

  it('should keep integers within bounds', () => {
    const random = new DemoRandom(7, now);

    for (let i = 0; i < 200; i++) {
      const value = random.int(3, 5);

      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(5);
    }
  });

  it('should return every deck item before repeating', () => {
    const random = new DemoRandom(3, now);
    const next = random.deck(['a', 'b', 'c']);

    expect([next(), next(), next()].sort()).toEqual(['a', 'b', 'c']);
  });

  it('should pick distinct items', () => {
    const picked = new DemoRandom(9, now).pickMany([1, 2, 3, 4], 3);

    expect(new Set(picked).size).toBe(3);
  });

  it('should compute dates relative to the reference time', () => {
    const random = new DemoRandom(1, now);

    expect(random.daysFromNow(1).toISOString()).toBe('2026-10-07T12:00:00.000Z');
    expect(random.daysAgo(2).toISOString()).toBe('2026-10-04T12:00:00.000Z');
  });
});

describe('slugify', () => {
  it('should create url-safe slugs', () => {
    expect(slugify('Krüger & Söhne GmbH')).toBe('kruger-sohne-gmbh');
    expect(slugify('  Straße  ')).toBe('strasse');
  });
});
