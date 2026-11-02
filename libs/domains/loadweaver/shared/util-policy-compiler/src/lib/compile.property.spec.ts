import { clusterNetworkSchema, policySpecSchema } from '@forepath/loadweaver/shared/util-model';

import { compileNetwork } from './compile';
import type { CompilationResult, CompilerInput, CompilerNode, CompilerWorkload, NamedPolicy } from './types';

/**
 * Policy compiler property tests (section 6): for random clusters, the compiled result admits exactly the
 * flows the policies allow, never more (never transitive), and tunnels exist only where flows need them.
 */

/** Small seeded PRNG (mulberry32) so failures are reproducible from the seed. */
function rng(seed: number): () => number {
  let a = seed;

  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);

    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const APPS = ['a', 'b', 'c', 'd'];
const PORTS = [80, 443, 5432];

interface Scenario {
  input: CompilerInput;
  /** Oracle: allowed (srcAddr, dstAddr, port) triples. */
  allowed: Set<string>;
}

function scenario(seed: number): Scenario {
  const random = rng(seed);
  const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)];
  const nodeCount = 2 + Math.floor(random() * 6);
  const nodes: CompilerNode[] = Array.from({ length: nodeCount }, (_, i) => ({
    name: `n${i}`,
    site: pick(['fra1', 'ams1']),
    labels: {},
    controlPlane: false,
    witness: false,
    overlayV4: `10.44.0.${i + 1}`,
    podSubnetV4: `10.42.${i + 1}.0/24`,
    endpointHost: `198.51.100.${i + 1}`,
    wireguardPublicKey: `k${i}`,
  }));
  const workloads: CompilerWorkload[] = [];
  const count = 2 + Math.floor(random() * 10);

  for (let i = 0; i < count; i++) {
    const n = Math.floor(random() * nodeCount);
    const app = pick(APPS);

    workloads.push({
      id: `p/${app}/${i}`,
      project: 'p',
      deployment: 'p',
      service: app,
      node: `n${n}`,
      labels: { app },
      addresses: [`10.42.${n + 1}.${10 + i}`],
    });
  }

  const intra = new Map(APPS.map((app) => [app, random() < 0.5]));
  const policies: NamedPolicy[] = [];
  const policyCount = Math.floor(random() * 5);

  for (let i = 0; i < policyCount; i++) {
    const from = pick(APPS);
    const to = pick(APPS);
    const port = pick(PORTS);

    policies.push({
      project: 'p',
      name: `pol${i}`,
      spec: policySpecSchema.parse({ from: [{ group: from }], to: [{ group: to }], rules: [{ ports: [port] }] }),
    });
  }

  const allowed = new Set<string>();

  for (const src of workloads) {
    for (const dst of workloads) {
      if (src.id === dst.id) continue;

      for (const port of PORTS) {
        const sameGroupAllowed = src.labels['app'] === dst.labels['app'] && intra.get(src.labels['app']);
        const policyAllowed = policies.some(
          (p) =>
            'group' in p.spec.from[0] &&
            'group' in p.spec.to[0] &&
            p.spec.from[0].group === src.labels['app'] &&
            p.spec.to[0].group === dst.labels['app'] &&
            p.spec.rules[0].ports?.includes(port),
        );

        if (sameGroupAllowed || policyAllowed) allowed.add(`${src.addresses[0]}>${dst.addresses[0]}:${port}`);
      }
    }
  }

  return {
    allowed,
    input: {
      network: clusterNetworkSchema.parse({ podPoolV4: '10.42.0.0/16', servicePoolV4: '10.43.0.0/16' }),
      nodes,
      workloads,
      services: [],
      nodeGroups: [],
      workloadGroups: APPS.map((app) => ({
        project: 'p',
        name: app,
        spec: {
          selector: { matchLabels: { app } },
          intraGroup: intra.get(app) ? ('allow' as const) : ('isolate' as const),
          exposed: false,
        },
      })),
      policies,
    },
  };
}

/** Does the destination node's forward chain admit src → dst on port? */
function admitted(result: CompilationResult, dstNode: string, src: string, dst: string, port: number): boolean {
  const fw = result.nodes[dstNode].firewall;

  return fw.rules.some(
    (r) =>
      r.chain === 'forward' &&
      fw.sets[r.srcSet].includes(`${src}/32`) &&
      fw.sets[r.dstSet].includes(`${dst}/32`) &&
      (r.protocol === 'any' || (r.protocol === 'tcp' && (r.ports.length === 0 || r.ports.includes(String(port))))),
  );
}

describe('policy compiler properties', () => {
  const seeds = Array.from({ length: 200 }, (_, i) => i + 1);

  it.each(seeds)('seed %i: firewall admits exactly the allowed flows', (seed) => {
    const { input, allowed } = scenario(seed);
    const result = compileNetwork(input);

    for (const src of input.workloads) {
      for (const dst of input.workloads) {
        if (src.id === dst.id) continue;

        for (const port of PORTS) {
          const expected = allowed.has(`${src.addresses[0]}>${dst.addresses[0]}:${port}`);

          expect({
            seed,
            src: src.id,
            dst: dst.id,
            port,
            admitted: admitted(result, dst.node, src.addresses[0], dst.addresses[0], port),
          }).toEqual({
            seed,
            src: src.id,
            dst: dst.id,
            port,
            admitted: expected,
          });
        }
      }
    }
  });

  it.each(seeds)('seed %i: tunnels and AllowedIPs exist only where allowed flows need them', (seed) => {
    const { input, allowed } = scenario(seed);
    const result = compileNetwork(input);
    const byAddress = new Map(input.workloads.map((w) => [w.addresses[0], w]));
    const neededPairs = new Set<string>();
    const neededRemote = new Map<string, Set<string>>();

    for (const key of allowed) {
      const [src, rest] = key.split('>');
      const dst = rest.split(':')[0];
      const a = byAddress.get(src)!;
      const b = byAddress.get(dst)!;

      if (a.node === b.node) continue;

      neededPairs.add(`${a.node}|${b.node}`).add(`${b.node}|${a.node}`);
      neededRemote.set(`${a.node}|${b.node}`, (neededRemote.get(`${a.node}|${b.node}`) ?? new Set()).add(`${dst}/32`));
      neededRemote.set(`${b.node}|${a.node}`, (neededRemote.get(`${b.node}|${a.node}`) ?? new Set()).add(`${src}/32`));
    }

    for (const [name, config] of Object.entries(result.nodes)) {
      for (const link of config.wireguard) {
        expect({ seed, link: `${name}|${link.peer}`, needed: neededPairs.has(`${name}|${link.peer}`) }).toEqual({
          seed,
          link: `${name}|${link.peer}`,
          needed: true,
        });

        const peerOverlay = input.nodes.find((n) => n.name === link.peer)!.overlayV4!;
        const workloadIps = link.allowedIps.filter((ip) => ip !== `${peerOverlay}/32`);

        expect(workloadIps.sort()).toEqual([...(neededRemote.get(`${name}|${link.peer}`) ?? [])].sort());
      }
    }

    for (const pair of neededPairs) {
      const [a, b] = pair.split('|');

      expect(result.nodes[a].wireguard.some((l) => l.peer === b)).toBe(true);
    }
  });
});
