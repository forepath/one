import { LabRecorder } from '@forepath/shared/backend/util-vm-lab';

import { GOLDEN_PINS } from '../golden';
import { startVmLab, type Vm, type VmLab } from '../vm-lab';

import { startCluster, type LabCluster } from './m7-cluster';
import {
  CP_IMAGE,
  downloadDebianCloudImage,
  eventually,
  IMAGE_HINTS,
  LAUNCHER_IMAGE,
  log,
  nestedDescribe,
  requireImages,
  requireNested,
  sleep,
} from './m7-lab';

/**
 * Isolation levels through the control plane (M7 W2 / W3, W4's control-plane side, W10's CPU rule): a two-node
 * cluster — n1 (control-plane member, nested KVM) and n2 (nested KVM, CPU without `avx2`, so its CPU flags hash
 * differs) — running the real agent with the lab reconciler and the control plane of this tree.
 *
 * (a) capabilities reach the control plane: per-node `runtimes`, derived labels `runtime.loadweaver.com/<level>`,
 *     `GET /nodes?runtime=microvm` / `?runtime=>=sandboxed-kvm`, `POST /nodes/:name/isolation-probe` re-probes;
 * (b) a compose deployment with one service per level runs each at exactly its level (`runc`, `runsc-systrap`,
 *     `runsc-kvm`, the microVM launcher), with the plan's "runs at exactly" notes; (c) a node opted out in its `Node`
 *     spec (`virtualization.kvm: disabled`) is refused while KVM workloads run there ("drain it first"), reports
 *     `disabled-by-admin` after a drain and is named in the ineligibility reason; (d) `/dev/kvm` device access needs
 *     the project allowance (policy error without, device present with it); (e) a `host-passthrough` VM between
 *     nodes with different CPU flags moves by short stop with the CPU reason, and waits with a plan note while its first
 *     boot-disk import runs (F4); the planner never moves a
 *     workload to another level.
 */

const PROJECT = 'iso';

nestedDescribe('scheduling by isolation level')(
  'exact-level scheduling through the control plane (VM lab, M7 W2 / W3)',
  () => {
    let lab: VmLab;
    let vm1: Vm;
    let vm2: Vm;
    let cluster: LabCluster;
    let nested = false;
    const rec = new LabRecorder('m7-scheduling');
    /** A host-passthrough VM pinned to one node. */
    const vmPass = (node: string) =>
      [
        'apiVersion: loadweaver.com/v1',
        'kind: VirtualMachine',
        `metadata: { name: pass, project: ${PROJECT} }`,
        'spec:',
        `  image: registry.lw/${PROJECT}/debian:13`,
        '  cpu: { vcpus: 1, model: host-passthrough }',
        '  memory: 512Mi',
        '  disks: [{ name: root, size: 4Gi, source: image, replicas: 2 }]',
        '  nics: [{ name: eth0 }]',
        `  placement: { selector: { names: [${node}] } }`,
      ].join('\n');

    /** The Docker runtime and launcher kind of a replica's container on whichever node runs it. */
    const runtimeOf = async (replica: string) => {
      const holder = await eventually(`${replica} placed`, () => cluster.holderOf(replica), 900_000, 5_000);
      const id = (
        await holder.vm.exec(`docker ps -q --filter label=loadweaver.com/workload=${replica} | head -n1`)
      ).trim();
      const [runtime, kind] = (
        await holder.vm.exec(
          `docker inspect -f '{{.HostConfig.Runtime}} {{index .Config.Labels "loadweaver.com/microvm"}}' ${id}`,
        )
      )
        .trim()
        .split(' ');

      return { node: holder.name, runtime, kind: kind === '<no value>' ? '' : kind };
    };

    beforeAll(async () => {
      await requireImages({ [LAUNCHER_IMAGE]: IMAGE_HINTS[LAUNCHER_IMAGE], [CP_IMAGE]: IMAGE_HINTS[CP_IMAGE] });
      lab = await rec.time('lab up', () =>
        startVmLab({
          vms: [
            { name: 'vm1', site: 'a', memoryMb: 3072, cpus: 3, nested: true, dataDiskGb: 6, rootDiskGb: 16 },
            {
              name: 'vm2',
              site: 'a',
              memoryMb: 2304,
              cpus: 2,
              nested: true,
              cpuFlags: ['-avx2'],
              dataDiskGb: 6,
              rootDiskGb: 16,
            },
          ],
          packages: ['attr'],
          log,
        }),
      );
      ({ vm1, vm2 } = lab.vms as Record<'vm1' | 'vm2', Vm>);
      nested = (await requireNested(vm1, 'scheduling')) && (await requireNested(vm2, 'scheduling'));

      if (!nested) return;

      cluster = await rec.time('cluster up', () =>
        startCluster([
          { vm: vm1, name: 'n1' },
          { vm: vm2, name: 'n2', labels: ['tier=vm'] },
        ]),
      );
      await cluster.apply(`apiVersion: loadweaver.com/v1\nkind: Project\nmetadata: { name: ${PROJECT} }\nspec: {}\n`);
    }, 3_600_000);

    afterAll(async () => {
      rec.flush();

      if (cluster && !nested)
        await cluster
          .diagnostics(vm1)
          .then((d) => log(d))
          .catch(() => undefined);

      await lab?.stop();
    }, 300_000);

    it('(a) reports the levels per node, derived labels, runtime queries and on-demand probes', async () => {
      if (!nested) return;

      const nodes = await eventually(
        'both nodes report all four levels',
        async () => {
          const list = await cluster.nodeList();

          return list.every((n) => (n['runtimes'] as string[] | undefined)?.includes('microvm')) ? list : undefined;
        },
        600_000,
        5_000,
      );

      rec.note(
        'nodes',
        nodes.map((n) => ({ name: n['name'], runtimes: n['runtimes'] })),
      );

      for (const n of nodes) {
        expect(n['effectiveLabels']).toMatchObject({
          'runtime.loadweaver.com/runc': 'ready',
          'runtime.loadweaver.com/microvm': 'ready',
          'loadweaver.com/runtime': 'microvm',
        });
      }

      expect((await cluster.ok('GET', '/nodes?runtime=microvm')).map((n: { name: string }) => n.name).sort()).toEqual([
        'n1',
        'n2',
      ]);
      expect((await cluster.ok('GET', '/nodes?runtime=%3E%3Dsandboxed-kvm')).length).toBe(2);

      const before = (await cluster.ok('GET', '/nodes/n2'))['capabilities']?.['isolation'];
      const probe = await cluster.api('POST', '/nodes/n2/isolation-probe');

      expect(probe.status).toBe(202);
      expect(probe.json).toMatchObject({ node: 'n2' });
      await eventually(
        're-probed',
        async () => {
          const now = (await cluster.ok('GET', '/nodes/n2'))['capabilities']?.['isolation'];

          return JSON.stringify(now) !== JSON.stringify(before) ? true : undefined;
        },
        300_000,
        5_000,
      ).catch(() => rec.verdict('isolation probe result changed its timestamps', false));
    });

    it('(b) runs every service at exactly its level', async () => {
      if (!nested) return;

      const plan = await cluster.plan(
        [
          'apiVersion: loadweaver.com/v1',
          'kind: Deployment',
          `metadata: { name: ladder, project: ${PROJECT} }`,
          'spec:',
          '  compose: |',
          '    services:',
          '      plain: { image: docker.io/library/alpine:3.22, command: [sleep, "1000000"] }',
          '      gvisor: { image: docker.io/library/alpine:3.22, command: [sleep, "1000000"], x-loadweaver: { runtime: sandboxed } }',
          '      gvisorkvm: { image: docker.io/library/alpine:3.22, command: [sleep, "1000000"], runtime: runsc-kvm }',
          '      micro:',
          '        image: docker.io/library/alpine:3.22',
          '        command: [sleep, "1000000"]',
          '        x-loadweaver: { runtime: microvm, microvm: { rootfsSize: 1Gi } }',
          '        deploy: { resources: { limits: { cpus: "1", memory: 256m } } }',
        ].join('\n'),
      );

      rec.note('plan notes', plan.warnings ?? plan.notes ?? []);
      expect(JSON.stringify(plan)).toMatch(/runs at exactly microvm/);
      await cluster.ok('POST', `/plans/${plan.id}/apply`, { confirm: true });

      const expected: Record<string, { runtime: RegExp; kind: string }> = {
        plain: { runtime: /^runc$/, kind: '' },
        gvisor: { runtime: /^runsc-systrap$/, kind: '' },
        gvisorkvm: { runtime: /^runsc-kvm$/, kind: '' },
        micro: { runtime: /^runc$/, kind: 'generic' },
      };

      for (const [service, want] of Object.entries(expected)) {
        const got = await runtimeOf(`${PROJECT}/ladder/${service}/0`);

        rec.note(`${service} placement`, got);
        expect(got.runtime).toMatch(want.runtime);
        expect(got.kind).toBe(want.kind);
      }
    });

    it('(c) refuses opting out a node with KVM workloads, then reports it disabled-by-admin with reasons', async () => {
      if (!nested) return;

      const site = (await cluster.ok('GET', '/nodes/n2'))['site'] ?? 'default';
      const nodeSpec = (kvm: 'auto' | 'disabled') =>
        `apiVersion: loadweaver.com/v1\nkind: Node\nmetadata: { name: n2 }\nspec:\n  site: ${site}\n  virtualization: { kvm: ${kvm} }\n`;
      const holders = await Promise.all(['gvisorkvm', 'micro'].map((s) => runtimeOf(`${PROJECT}/ladder/${s}/0`)));

      if (holders.some((h) => h.node === 'n2')) {
        const refused = await cluster.plan(nodeSpec('disabled'));

        expect(JSON.stringify(refused)).toMatch(/drain it first/);
        await cluster.ok('POST', '/nodes/n2/drain');
        await eventually(
          'n2 drained of KVM workloads',
          async () => {
            const again = await Promise.all(['gvisorkvm', 'micro'].map((s) => runtimeOf(`${PROJECT}/ladder/${s}/0`)));

            return again.every((h) => h.node === 'n1') ? true : undefined;
          },
          900_000,
          10_000,
        );
      }

      await cluster.apply(nodeSpec('disabled'));
      await eventually(
        'n2 disabled-by-admin',
        async () => {
          const iso = (await cluster.ok('GET', '/nodes/n2'))['capabilities']?.['isolation'];

          return iso?.['microvm']?.state === 'disabled-by-admin' ? true : undefined;
        },
        600_000,
        5_000,
      );

      // A microVM pinned to n2 can't be placed; the reason names the opt-out.
      const pinned = await cluster.plan(
        [
          'apiVersion: loadweaver.com/v1',
          'kind: Deployment',
          `metadata: { name: pinned, project: ${PROJECT} }`,
          'spec:',
          '  compose: |',
          '    services:',
          '      micro:',
          '        image: docker.io/library/alpine:3.22',
          '        command: [sleep, "1000000"]',
          '        x-loadweaver: { runtime: microvm, placement: { selector: { names: [n2] } } }',
        ].join('\n'),
      );

      expect(JSON.stringify(pinned)).toMatch(/disabled by node spec/);
      await cluster.apply(nodeSpec('auto'));
      await cluster.ok('POST', '/nodes/n2/uncordon').catch(() => undefined);
    });

    it('(d) needs the project allowance for /dev/kvm device access', async () => {
      if (!nested) return;

      const deployment = [
        'apiVersion: loadweaver.com/v1',
        'kind: Deployment',
        `metadata: { name: kvmdev, project: ${PROJECT} }`,
        'spec:',
        '  compose: |',
        '    services:',
        '      vmm: { image: docker.io/library/alpine:3.22, command: [sh, -c, "ls -l /dev/kvm; sleep 1000000"], devices: ["/dev/kvm:/dev/kvm:rwm"] }',
      ].join('\n');

      expect(JSON.stringify(await cluster.plan(deployment))).toMatch(/allowedDevices|not allowed/);
      await cluster.apply(
        `apiVersion: loadweaver.com/v1\nkind: Project\nmetadata: { name: ${PROJECT} }\nspec:\n  workloads: { allowedDevices: ['/dev/kvm'] }\n`,
      );

      const applied = await cluster.apply(deployment);

      expect(JSON.stringify(applied)).toMatch(/device access \(\/dev\/kvm\)/);

      const holder = await eventually('vmm placed', () => cluster.holderOf(`${PROJECT}/kvmdev/vmm/0`), 600_000, 5_000);
      const logs = await eventually(
        'device visible',
        async () =>
          (
            await holder.vm.exec(
              `docker logs $(docker ps -q --filter label=loadweaver.com/workload=${PROJECT}/kvmdev/vmm/0) 2>&1`,
            )
          ).match(/\/dev\/kvm/)?.[0],
      );

      expect(logs).toBeTruthy();
    });

    it('(e) moves a host-passthrough VM between unequal CPUs by short stop with the CPU reason', async () => {
      if (!nested) return;

      const hashes = (await cluster.nodeList()).map((n) => n['capabilities']?.['cpuFlagsHash']);

      rec.note('cpu flag hashes', hashes);
      expect(new Set(hashes).size).toBe(2);

      const sha256 = (await vm1.exec(`sha256sum ${await downloadDebianCloudImage(vm1)} | cut -d' ' -f1`)).trim();
      const image = await cluster.ok('POST', `/projects/${PROJECT}/vm-images/import`, {
        url: GOLDEN_PINS.debianImage.url,
        sha256,
        ref: 'debian:13',
        firmware: ['uefi', 'bios'],
      });

      rec.note('URL import', image);
      await eventually(
        'image imported',
        async () => {
          const imports = (await cluster.ok('GET', `/projects/${PROJECT}/vm-images/imports`)) as Array<{
            status: string;
          }>;

          if (imports.some((i) => i.status === 'failed'))
            throw new Error(`URL import failed: ${JSON.stringify(imports)}`);

          return imports.some((i) => i.status === 'succeeded') ? true : undefined;
        },
        1_800_000,
        15_000,
      );
      await cluster.apply(vmPass('n1'), 1_800_000);
      // F4: while the first boot-disk import runs, a planned move waits (plan note, no move).
      const importing = await eventually(
        'boot-disk import reported',
        async () => {
          const vm = await cluster.ok('GET', `/projects/${PROJECT}/virtual-machines/pass`);

          return vm['status']?.['importProgress'] || vm['importProgress'] ? vm : undefined;
        },
        300_000,
        3_000,
      ).catch(() => null);

      if (importing) {
        const held = await cluster.plan(vmPass('n2'));

        rec.note('plan while importing', held.warnings ?? held);
        rec.verdict(
          'a planned move waits for the boot-disk import (F4)',
          /stays on n1 while waiting for the boot-disk import/.test(JSON.stringify(held)),
        );
        await cluster.ok('POST', `/plans/${held.id}/discard`).catch(() => undefined);
      } else
        rec.verdict(
          'a planned move waits for the boot-disk import (F4)',
          false,
          'import finished before it could be observed',
        );

      await eventually(
        'VM running',
        async () => {
          const vm = await cluster.ok('GET', `/projects/${PROJECT}/virtual-machines/pass`);

          return vm['phase'] === 'Running' ? vm : undefined;
        },
        1_800_000,
        10_000,
      );
      // Moving it (placement → n2): the planner picks a short stop, never QEMU live migration, with the CPU reason.
      await cluster.apply(vmPass('n2'), 1_800_000);

      const history = await eventually(
        'migration recorded',
        async () => {
          const list = (await cluster.ok(
            'GET',
            `/migrations?replica=${encodeURIComponent(`${PROJECT}/lw-vm/pass/0`)}`,
          )) as Array<Record<string, unknown>>;

          return list.length ? list : undefined;
        },
        900_000,
        10_000,
      );

      rec.note('migration of the host-passthrough VM', history);
      expect(JSON.stringify(history)).not.toMatch(/"method":"vm-live/);
      expect(JSON.stringify(history)).toMatch(/cpu|CPU/);
      await sleep(1_000);
    });
  },
);
