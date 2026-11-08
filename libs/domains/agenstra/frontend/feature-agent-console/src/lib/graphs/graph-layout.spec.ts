import {
  defaultIterations,
  fitTransform,
  hashSeed,
  matchNodes,
  screenRadiusPx,
  screenToWorld,
  seededRandom,
  zoomAt,
  type GraphLayoutInputNode,
} from './graph-layout';

describe('graph layout math', () => {
  it('scales the iteration budget down for large graphs', () => {
    expect(defaultIterations(100)).toBeGreaterThan(defaultIterations(1000));
    expect(defaultIterations(1000)).toBeGreaterThan(defaultIterations(6000));
    expect(defaultIterations(6000)).toBeGreaterThan(defaultIterations(1_000_000));
  });

  it('fits bounds into the viewport and zooms around a point', () => {
    const transform = fitTransform({ minX: -110, minY: -10, maxX: 110, maxY: 10 }, 440, 300, { padding: 0 });

    expect(transform.k).toBeCloseTo(2);
    expect(transform.x).toBeCloseTo(220);

    const zoomed = zoomAt(transform, 50, 60, 2);
    const before = screenToWorld(transform, 50, 60);
    const after = screenToWorld(zoomed, 50, 60);

    expect(zoomed.k).toBeCloseTo(transform.k * 2);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(fitTransform(null, 400, 300)).toEqual({ x: 200, y: 150, k: 1 });
  });

  it('keeps drawn radii readable when zoomed out and capped when zoomed in', () => {
    expect(screenRadiusPx(4, 0.01)).toBe(2);
    expect(screenRadiusPx(4, 1)).toBe(4);
    expect(screenRadiusPx(4, 100)).toBe(18);
  });

  it('matches nodes by label prefix first, then label, path and id', () => {
    const nodes: GraphLayoutInputNode[] = [
      { id: 'file:src/user-auth.ts', type: 'file', label: 'user-auth.ts', path: 'src/user-auth.ts' },
      { id: 'symbol:x#AuthService', type: 'symbol', label: 'AuthService' },
      { id: 'file:src/a.ts', type: 'file', label: 'a.ts', path: 'src/auth/a.ts' },
      { id: 'file:src/b.ts', type: 'file', label: 'b.ts' },
    ];

    expect(matchNodes(nodes, ' auth ')).toEqual(['symbol:x#AuthService', 'file:src/user-auth.ts', 'file:src/a.ts']);
    expect(matchNodes(nodes, 'auth', 1)).toEqual(['symbol:x#AuthService']);
    expect(matchNodes(nodes, '')).toEqual([]);
  });

  it('produces stable seeds and pseudo random numbers', () => {
    expect(hashSeed(['a', 'b'])).toBe(hashSeed(['a', 'b']));
    expect(hashSeed(['a', 'b'])).not.toBe(hashSeed(['b', 'a']));

    const random = seededRandom(42);
    const values = [random(), random(), random()];

    expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
    expect(seededRandom(42)()).toBe(values[0]);
  });
});
