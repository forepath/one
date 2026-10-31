import type { AutoscaleSpec } from '@forepath/loadweaver/shared/util-compose';
import type { SchedulerNode, SchedulerService } from '@forepath/loadweaver/shared/util-scheduler';

import { projectUsage } from '../access/plan-access.utils';
import type { ParsedDeployment } from '../utils/workload-planning.utils';
import {
  applyAutoscaledReplicas,
  autoscaledCount,
  autoscaleMapData,
  autoscalePlanLine,
  autoscalePlanNotes,
  combineHostValues,
  DEFAULT_AUTOSCALE_TIMING,
  largestAllowed,
  placeScaleUp,
  quotaBlock,
  recommend,
  replicasToRemove,
  type AutoscaleWindowEntry,
  type RecommendInput,
} from './autoscale.utils';

const cpu: AutoscaleSpec = { min: 2, max: 10, metric: 'cpu', target: 50 };
const T0 = 1_800_000_000_000;
const S = 1000;

const input = (extra: Partial<RecommendInput> = {}): RecommendInput => ({
  spec: cpu,
  current: 4,
  value: 50,
  now: T0,
  window: [],
  lastScaleAt: null,
  ...extra,
});

/** Runs ticks every 15 s with the given values, carrying window, replicas and last scale like the service. */
function simulate(
  values: (number | null)[] | ((current: number, i: number) => number | null),
  start: { current: number; lastScaleAt?: number | null; ticks?: number },
) {
  let current = start.current;
  let window: AutoscaleWindowEntry[] = [];
  let lastScaleAt = start.lastScaleAt ?? null;
  const history: { at: number; action: string; current: number; reason: string }[] = [];

  const ticks = Array.isArray(values) ? values.length : (start.ticks ?? 0);

  for (let i = 0; i < ticks; i++) {
    const value = Array.isArray(values) ? values[i] : values(current, i);
    const now = T0 + i * 15 * S;
    const rec = recommend({ spec: cpu, current, value, now, window, lastScaleAt });

    window = rec.window;

    if (rec.desired !== current) {
      current = rec.desired;
      lastScaleAt = now;
    }

    history.push({ at: now, action: rec.action, current, reason: rec.reason });
  }

  return history;
}

describe('recommend (HPA formula, 3.23)', () => {
  it('computes ceil(current × value / target)', () => {
    expect(recommend(input({ value: 100 })).desired).toBe(8);
    expect(recommend(input({ value: 60, current: 3 })).desired).toBe(4); // ceil(3.6)
    expect(recommend(input({ value: 100 })).reason).toBe('cpu 100 % / target 50 %');
  });

  it('holds within the 10 % tolerance on both sides', () => {
    expect(recommend(input({ value: 54.9 }))).toMatchObject({ action: 'hold', desired: 4 });
    expect(recommend(input({ value: 45.1 }))).toMatchObject({ action: 'hold', desired: 4 });
    expect(recommend(input({ value: 55.1 }))).toMatchObject({ action: 'up', desired: 5 });
    expect(recommend(input({ value: 54.9 })).reason).toContain('within 10 % of the target');
  });

  it('scales up right away, bounded to max(×2, +4) per step', () => {
    expect(recommend(input({ value: 500, current: 2 })).desired).toBe(6); // 2 + 4
    expect(recommend(input({ value: 1000, spec: { ...cpu, max: 100 }, current: 10 })).desired).toBe(20); // × 2
    expect(recommend(input({ value: 500, current: 2 })).reason).toContain('step limited, wants 10');
  });

  it('clamps to min and max and reports wanting more than max', () => {
    const atMax = recommend(input({ value: 500, current: 10 }));

    expect(atMax).toMatchObject({ action: 'hold', desired: 10, atMax: true });
    expect(atMax.reason).toContain('at max 10 (wants 100)');
    expect(recommend(input({ value: 500, current: 8 }))).toMatchObject({ action: 'up', desired: 10, atMax: true });
    expect(recommend(input({ value: 1, current: 2 })).reason).toContain('at min 2');
  });

  it('brings a count outside min..max back into the range first', () => {
    expect(recommend(input({ current: 1, value: null }))).toMatchObject({ action: 'up', desired: 2 });
    expect(recommend(input({ current: 12, value: 500 }))).toMatchObject({ action: 'down', desired: 10 });
  });

  it('holds with the reason when the metric is missing, keeping the window', () => {
    const window = [{ at: T0 - 60 * S, replicas: 6 }];
    const rec = recommend(input({ value: null, missing: 'no cpu samples of its replicas in the last minute', window }));

    expect(rec).toMatchObject({ action: 'hold', desired: 4, raw: null });
    expect(rec.reason).toBe('holding: no cpu samples of its replicas in the last minute');
    expect(rec.window).toEqual(window);
  });

  it('applies the up cooldown after a scaling action', () => {
    expect(recommend(input({ value: 100, lastScaleAt: T0 - 10 * S }))).toMatchObject({ action: 'hold', desired: 4 });
    expect(recommend(input({ value: 100, lastScaleAt: T0 - 10 * S })).reason).toContain('cooldown');
    expect(recommend(input({ value: 100, lastScaleAt: T0 - 31 * S }))).toMatchObject({ action: 'up', desired: 8 });
  });
});

describe('scale-down stabilisation (3.23)', () => {
  it('scales down only after 5 minutes of lower recommendations, to the highest of the window', () => {
    // 4 replicas at 25 % → wants 2, for 6 minutes.
    const history = simulate(Array(25).fill(25), { current: 4 });
    const firstDown = history.find((h) => h.action === 'down');

    expect(firstDown?.at).toBeGreaterThanOrEqual(T0 + 4.5 * 60 * S);
    expect(firstDown?.current).toBe(2);
    expect(history.filter((h) => h.at < T0 + 4.5 * 60 * S).every((h) => h.action === 'hold')).toBe(true);
    expect(history[1].reason).toContain('stabilising, scale-down to 2 once lower for 5 min');
  });

  it('a higher recommendation inside the window caps the scale-down', () => {
    // High load (wants 6) once, then low (wants 2): 5 minutes after the peak it goes down, not before.
    const values = [75, ...Array(30).fill(25)];
    const history = simulate(values, { current: 4 });

    expect(history[0]).toMatchObject({ action: 'up', current: 6 });
    // 6 replicas at 25 % → 3; the window still holds 6 until the peak is 5 minutes old.
    const down = history.find((h) => h.action === 'down');

    expect(down?.at).toBeGreaterThanOrEqual(T0 + 5 * 60 * S);
  });

  it('does not flap around the target', () => {
    // Constant load of 2 CPU-requests' worth, measured ±16 % every other tick, for 10 minutes.
    const history = simulate((current, i) => (200 / current) * (i % 2 === 0 ? 1.16 : 0.84), {
      current: 4,
      ticks: 40,
    });

    // One step up for the peaks, then steady: the troughs never get through the stabilisation window.
    expect(history.filter((h) => h.action === 'up')).toHaveLength(1);
    expect(history.filter((h) => h.action === 'down')).toHaveLength(0);
    expect(history.at(-1)?.current).toBe(5);
  });

  it('batches scale-down steps with the down cooldown', () => {
    const window = Array.from({ length: 21 }, (_, i) => ({ at: T0 - (300 - i * 15) * S + 15 * S, replicas: 3 }));
    const rec = recommend(input({ value: 10, window, lastScaleAt: T0 - 20 * S }));

    expect(rec).toMatchObject({ action: 'hold', desired: 4 });
    expect(rec.reason).toContain('cooldown, scaling down to 3');
    expect(recommend(input({ value: 10, window, lastScaleAt: T0 - 61 * S }))).toMatchObject({
      action: 'down',
      desired: 3,
    });
  });

  it('prunes the window to 5 minutes', () => {
    const rec = recommend(
      input({
        window: [
          { at: T0 - 301 * S, replicas: 9 },
          { at: T0 - 100 * S, replicas: 5 },
        ],
      }),
    );

    expect(rec.window).toEqual([
      { at: T0 - 100 * S, replicas: 5 },
      { at: T0, replicas: 4 },
    ]);
    expect(DEFAULT_AUTOSCALE_TIMING.downWindowMs).toBe(300_000);
  });
});

describe('limits (quota, capacity, N+1)', () => {
  it('finds the largest allowed count', () => {
    expect(largestAllowed(2, 8, () => null)).toEqual({ replicas: 8, blocked: null });
    expect(largestAllowed(2, 8, (n) => (n > 5 ? `quota at ${n}` : null))).toEqual({
      replicas: 5,
      blocked: 'quota at 6',
    });
    expect(largestAllowed(2, 8, () => 'full')).toEqual({ replicas: 2, blocked: 'full' });
    expect(largestAllowed(4, 3, () => 'full')).toEqual({ replicas: 3, blocked: null });
  });

  it('keeps scale-ups within the project quota', () => {
    const quota = { cpu: '2', memory: '4g' };
    const usage = { cpuMillis: 1500, memoryBytes: 1024 ** 3, storageBytes: 0, publicIps: 0, ports: 0 };
    const requests = { cpuMillis: 250, memoryBytes: 256 * 1024 ** 2 };

    expect(quotaBlock('shop', quota, usage, requests, 2)).toBeNull();
    expect(quotaBlock('shop', quota, usage, requests, 3)).toBe('project shop quota: CPU 2.25 would exceed 2');
    expect(quotaBlock('shop', { memory: '1.5g' }, usage, requests, 3)).toBe(
      'project shop quota: memory 1.75 GiB would exceed 1.5 GiB',
    );
    expect(quotaBlock('shop', undefined, usage, requests, 100)).toBeNull();
  });

  const node = (name: string, cpuMillis = 1000): SchedulerNode => ({
    name,
    site: 'fra1',
    labels: {},
    lifecycle: 'active',
    witness: false,
    capacity: { cpuMillis, memoryBytes: 8 * 1024 ** 3 },
    diskBytes: 1e12,
    runtimes: ['runc'],
    reachable: true,
  });
  const web = (replicas: number): SchedulerService => ({
    id: 'shop/web/api',
    project: 'shop',
    replicas,
    requests: { cpuMillis: 250, memoryBytes: 64 * 1024 ** 2 },
    runtime: 'runc',
    spread: 'node',
    volumes: [],
  });
  const placed = (nodes: string[]) =>
    nodes.map((n, i) => ({ service: 'shop/web/api', replica: `shop/web/api/${i}`, node: n }));

  it('places new replicas without moving the others', () => {
    const out = placeScaleUp(
      {
        nodes: [node('n1', 4000), node('n2', 4000), node('n3', 4000)],
        services: [web(2)],
        current: { replicas: placed(['n1', 'n2']), volumes: [] },
      },
      'shop/web/api',
      3,
    );

    expect(out).toEqual({ issue: null, added: [{ service: 'shop/web/api', replica: 'shop/web/api/2', node: 'n3' }] });
  });

  it('refuses what the cluster capacity cannot hold', () => {
    const out = placeScaleUp(
      { nodes: [node('n1', 500)], services: [web(2)], current: { replicas: placed(['n1', 'n1']), volumes: [] } },
      'shop/web/api',
      3,
    );

    expect(out.issue).toBe('cluster capacity: not enough free capacity on eligible nodes');
  });

  it('keeps the N+1 reserve', () => {
    // Two nodes of 1 CPU, 0.25 per replica: 4 replicas (2 + 2) survive a node loss, 6 (3 + 3) fit but would not.
    const input = {
      nodes: [node('n1'), node('n2')],
      services: [web(2)],
      current: { replicas: placed(['n1', 'n2']), volumes: [] },
    };

    expect(placeScaleUp(input, 'shop/web/api', 6).issue).toBe(
      'N+1 reserve: the cluster could no longer absorb the loss of a node',
    );
    expect(placeScaleUp(input, 'shop/web/api', 4).issue).toBeNull();
    // A single workload node has no reserve to keep: capacity only.
    expect(
      placeScaleUp(
        { nodes: [node('n1')], services: [web(1)], current: { replicas: placed(['n1']), volumes: [] } },
        'shop/web/api',
        4,
      ).issue,
    ).toBeNull();
  });

  it('removes the newest replicas first', () => {
    expect(replicasToRemove(['a/b/c/0', 'a/b/c/10', 'a/b/c/2', 'a/b/c/9'], 2)).toEqual(['a/b/c/10', 'a/b/c/9']);
    expect(replicasToRemove(['a/b/c/0'], 3)).toEqual([]);
  });
});

describe('autoscaled replica counts in plans', () => {
  const parsed = (): ParsedDeployment[] => [
    {
      project: 'shop',
      name: 'web',
      compose: {
        name: 'web',
        networks: [],
        secrets: [],
        configs: [],
        volumes: [],
        services: [
          {
            name: 'api',
            kind: 'service',
            replicas: 3,
            autoscale: { min: 2, max: 10, metric: 'cpu', target: 70 },
            resources: { requests: { cpuMillis: 500, memoryBytes: 1024 ** 3 }, limits: {}, source: 'compose' },
            runtime: 'runc',
            spread: 'node',
            volumes: [],
            ports: [],
          },
          {
            name: 'worker',
            kind: 'service',
            replicas: 1,
            resources: { requests: { cpuMillis: 500, memoryBytes: 1024 ** 3 }, limits: {}, source: 'compose' },
            runtime: 'runc',
            spread: 'node',
            volumes: [],
            ports: [],
          },
        ],
      },
    } as unknown as ParsedDeployment,
  ];

  it('uses the autoscaler count within min..max, the compose count at first', () => {
    expect(autoscaledCount(cpu, undefined, 3)).toBe(3);
    expect(autoscaledCount(cpu, 1, 3)).toBe(2);
    expect(autoscaledCount(cpu, 12, 3)).toBe(10);

    const p = parsed();
    const autoscaled = applyAutoscaledReplicas(p, new Map([['shop/web/api', 7]]));

    expect(p[0].compose.services.map((s) => s.replicas)).toEqual([7, 1]);
    expect(autoscaled).toEqual([expect.objectContaining({ id: 'shop/web/api', replicas: 7, composeReplicas: 3 })]);
    expect(autoscalePlanLine(autoscaled[0])).toBe('autoscaled 7 (2..10), cpu target 70 % of the request');
  });

  it('checks quotas against min, and warns when max exceeds them', () => {
    const p = parsed();
    const autoscaled = applyAutoscaledReplicas(p, new Map([['shop/web/api', 7]]));
    const resources = [{ kind: 'Project', name: 'shop', project: null, spec: { quota: { cpu: '3' } } }];
    const min = projectUsage(p, resources);

    // 2 × 0.5 (min) + 1 × 0.5 = 1.5 CPU; with the current 7: 4 CPU.
    expect(min.get('shop')?.cpuMillis).toBe(1500);
    expect(projectUsage(p, resources, new Map(), 'current').get('shop')?.cpuMillis).toBe(4000);

    const notes = autoscalePlanNotes(p, autoscaled, min, new Map([['shop', { cpu: '3' }]]), new Set(['shop/web']));

    expect(notes).toEqual([
      expect.objectContaining({
        level: 'info',
        path: 'services.api.x-loadweaver.autoscale',
        message: 'autoscaled 7 (2..10), cpu target 70 % of the request',
      }),
      expect.objectContaining({
        level: 'warning',
        message:
          'at max replicas, autoscaled services exceed the quota: CPU 5.5 would exceed 3; the autoscaler stops at the quota',
      }),
    ]);
    // Deployments the plan doesn't submit get no notes.
    expect(autoscalePlanNotes(p, autoscaled, min, new Map(), new Set())).toEqual([]);
  });

  it('combines hostname values and decorates the map', () => {
    expect(combineHostValues('ingress.requests_per_s', [2, 3])).toBe(5);
    expect(combineHostValues('ingress.latency_p95_ms', [200, 410])).toBe(410);
    expect(combineHostValues('x', [])).toBeNull();
    expect(
      autoscaleMapData({
        replicas: 4,
        last_scale_at: new Date(T0),
        last_reason: '2 → 4: cpu 140 % / target 70 %',
        status: { min: 2, max: 10, blocked: 'at max 10 replicas' },
      }),
    ).toEqual({
      autoscaled: '4 (2..10)',
      lastScaled: `${new Date(T0).toISOString()} 2 → 4: cpu 140 % / target 70 %`,
      autoscaleBlocked: 'at max 10 replicas',
    });
  });
});
