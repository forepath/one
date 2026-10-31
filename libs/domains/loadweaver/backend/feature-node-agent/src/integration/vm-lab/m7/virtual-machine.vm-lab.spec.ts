import { randomBytes } from 'node:crypto';

import { LabRecorder } from '@forepath/shared/backend/util-vm-lab';
import type { VolumeAssignment, WorkloadSpec } from '@forepath/loadweaver/shared/util-agent-protocol';

import { startVmLab, type Vm, type VmLab } from '../vm-lab';

import {
  downloadDebianCloudImage,
  eventually,
  IMAGE_HINTS,
  LAB_CA_FILE,
  type LabVmOptions,
  LAUNCHER_IMAGE,
  loadImages,
  log,
  nestedDescribe,
  type NodeDriver,
  podNetwork,
  type PushedVmImage,
  pushVmArtifact,
  requireImages,
  requireNested,
  restartNodeDriver,
  serialText,
  startLabRegistry,
  startNodeDriver,
  trustLabRegistry,
  vmVolumes,
  vmWorkload,
  workload,
} from './m7-lab';

/**
 * Full VMs on real kernels, node side (M7 W9 + F3a / F3b, 3.35): the M7 node driver (real `VmSupport`,
 * `VmImageImporter`, `CloudInitSeed`, `VmPower`, block-mode `VolumeManager`, the launcher's `launch-vm` / `vm-ctl`)
 * on two Debian 13 VMs with nested KVM; images come from a lab registry (TLS, lab CA) as Loadweaver VM artifacts
 * (qcow2, raw+zstd) and as a KubeVirt containerDisk. The test plays the control plane (desired state, `vmPower`,
 * `vmImageImport`).
 *
 * (a) first boot of the Debian cloud image (qcow2 artifact) onto a 2-replica DRBD disk: import in the launcher's
 *     locked-down import mode, cloud-init (host name, ssh key, `${LW_DNS}`, MTU, a `secret://` user data substituted
 *     on the node), the seed only on tmpfs and the secret nowhere on disk; the background import (F3b) reports
 *     `importing` while another workload of the same apply already runs; (b) a second NIC with its own tap and
 *     address; (c) power: reboot / reset / shutdown / destroy through `vmPower`, power states in the status, outcomes
 *     as events (with an explicit `action` label); (d) failover: vm1 crashes, the disk is promoted on vm2 and adopted —
 *     never re-imported — and the VM boots with its data; (e) the agent killed mid-import re-imports on restart;
 *     (f) reimage of a stopped VM (`vmImageImport`) writes the image again; (g) raw+zstd and containerDisk images boot;
 *     (h) a third concurrent import is queued, imports of VMs that go are cancelled and their disks demoted; (i) a
 *     failing import (bad layer digest) shows `failed` with an event (F3b).
 * Block backups / restore and the API side are in vm-api.vm-lab.spec.ts (they need the cluster's Kopia server).
 */

const SUBNET = '10.244.1.0/24';
const SECRET_REF = 'secret://lab/vm-user-data';
const SECRET_VALUE = `lw-lab-secret-${randomBytes(8).toString('hex')}`;

nestedDescribe('full VMs')('full VMs on real kernels, node side (VM lab, M7 W9 / F3a / F3b)', () => {
  let lab: VmLab;
  let vm1: Vm;
  let vm2: Vm;
  let n1: NodeDriver;
  let n2: NodeDriver;
  let nested = false;
  let registry = '';
  let qcow2: PushedVmImage;
  let web: LabVmOptions;
  let volumes1: VolumeAssignment[] = [];
  let sshKey = '';
  const rec = new LabRecorder('m7-virtual-machine');
  const WEB = 'lab/lw-vm/web/0';

  /** ssh into the guest from its node (the guest's /32 is routed to the launcher's interface there). */
  const guest = (vm: Vm, ip: string, script: string) =>
    vm.exec(
      `ssh -i /root/.ssh/lab_vm -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 -o BatchMode=yes debian@${ip} 'sudo bash -s' <<'LWEOF'\n${script}\nLWEOF`,
      { timeoutMs: 120_000 },
    );
  const sshReadyOnce = (vm: Vm, ip: string, timeoutMs = 600_000) =>
    eventually(
      `ssh to ${ip} from ${vm.name}`,
      async () =>
        (await guest(vm, ip, 'true')
          .then(() => true)
          .catch(() => false))
          ? true
          : undefined,
      timeoutMs,
      5_000,
    );
  /** ssh into a guest; on timeout, what the node saw (containers, statuses, the agent's journal) is recorded (G5). */
  const sshReady = (vm: Vm, ip: string, timeoutMs = 600_000) =>
    sshReadyOnce(vm, ip, timeoutMs).catch(async (error: unknown) => {
      rec.note(
        `containers on ${vm.name}`,
        await vm.exec("docker ps -a --format '{{.Names}} {{.Status}}'").catch(String),
      );
      rec.note(`statuses on ${vm.name}`, JSON.stringify((await (vm === vm1 ? n1 : n2).status()).workloads));
      rec.note(
        `agent journal on ${vm.name}`,
        await vm
          .exec(
            "journalctl -u lw-m7 --no-pager -o cat | grep -vE 'Unpack cache GC|DockerForward|NestFactory|InstanceLoader|RoutesResolver' | tail -n 60",
          )
          .catch(String),
      );
      throw error;
    });
  const power = async (driver: NodeDriver, replica: string) =>
    String(
      ((await driver.status()).workloads.find((w) => w['id'] === replica)?.['vm'] as { power?: string } | undefined)
        ?.power ?? '',
    );
  const lvTags = (vm: Vm, volumeId: string) =>
    vm
      .exec(
        `lvs --noheadings -o lv_tags loadweaver 2>/dev/null | tr ',' '\\n' | grep -E 'lw\\.(init|importing)' || true`,
      )
      .then((o) => `${volumeId}: ${o.trim()}`);

  beforeAll(async () => {
    await requireImages({ [LAUNCHER_IMAGE]: IMAGE_HINTS[LAUNCHER_IMAGE] });
    lab = await rec.time('lab up', () =>
      startVmLab({
        vms: [
          { name: 'vm1', site: 'a', memoryMb: 2560, cpus: 2, nested: true, dataDiskGb: 12, rootDiskGb: 16 },
          { name: 'vm2', site: 'a', memoryMb: 2560, cpus: 2, nested: true, dataDiskGb: 12 },
        ],
        packages: ['attr', 'zstd', 'qemu-utils', 'python3'],
        log,
      }),
    );
    ({ vm1, vm2 } = lab.vms as Record<'vm1' | 'vm2', Vm>);
    nested = (await requireNested(vm1, 'full VMs')) && (await requireNested(vm2, 'full VMs'));

    if (!nested) return;

    await Promise.all([loadImages(vm1, [LAUNCHER_IMAGE]), loadImages(vm2, [LAUNCHER_IMAGE])]);

    const reg = await startLabRegistry(vm1);

    registry = reg.host;
    await trustLabRegistry(vm2, registry, reg.ca);
    await vm1.exec("install -d -m 0700 /root/.ssh && ssh-keygen -q -t ed25519 -N '' -f /root/.ssh/lab_vm");
    sshKey = (await vm1.exec('cat /root/.ssh/lab_vm.pub')).trim();
    await vm2.exec(
      `install -d -m 0700 /root/.ssh && cat > /root/.ssh/lab_vm <<'EOF'\n${(await vm1.exec('cat /root/.ssh/lab_vm')).trim()}\nEOF\nchmod 0600 /root/.ssh/lab_vm`,
    );

    const secrets = { [SECRET_REF]: SECRET_VALUE };

    [n1, n2] = await Promise.all([
      startNodeDriver(vm1, { storage: true, labCa: reg.ca, secrets, peers: [vm2] }),
      startNodeDriver(vm2, { storage: true, labCa: reg.ca, secrets, peers: [vm1] }),
    ]);

    const disk = await downloadDebianCloudImage(vm1);

    qcow2 = await rec.time('push qcow2 artifact', () =>
      pushVmArtifact(vm1, registry, 'lab/debian', '13', { path: disk, format: 'qcow2' }),
    );
    web = {
      name: 'web',
      image: qcow2,
      disks: [
        { name: 'boot', sizeBytes: 4 * 1024 ** 3 },
        { name: 'data', sizeBytes: 256 * 1024 ** 2 },
      ],
      nics: [
        { name: 'nic0', addresses: ['10.244.1.50'] },
        { name: 'nic1', addresses: ['10.244.1.51'] },
      ],
      memoryMiB: 512,
      sshKeys: [sshKey],
      secretRefs: [SECRET_REF],
      userData: [
        '#cloud-config',
        'write_files:',
        '  - path: /root/lab-secret',
        '    permissions: "0600"',
        `    content: "${SECRET_REF}"`,
        'runcmd:',
        "  - [sh, -c, 'echo LW-LAB-CLOUD-INIT-DONE > /dev/ttyS0']",
      ].join('\n'),
    };
  }, 3_600_000);

  afterAll(async () => {
    rec.flush();
    await lab?.stop();
  }, 300_000);

  it('(a) imports the qcow2 artifact onto a 2-replica disk in the background and boots it with cloud-init', async () => {
    if (!nested) return;

    const sidecar = workload({ id: 'lab/side/app/0', addresses: ['10.244.1.10'] });
    const spec = vmWorkload(web);

    volumes1 = vmVolumes(web, [vm1, vm2], vm1, { minor: 1200, port: 7950 });
    await n2.apply({
      workloads: [],
      volumes: vmVolumes(web, [vm1, vm2], vm1, { minor: 1200, port: 7950 }),
      network: podNetwork(SUBNET),
    });

    const start = Date.now();

    await n1.apply({ workloads: [sidecar, spec], volumes: volumes1, network: podNetwork(SUBNET) });

    // F3b: the import runs in the background — the status says so while the other workload already runs.
    const importing = await eventually(
      'importing reported',
      async () => {
        const entry = (await n1.status()).workloads.find((w) => w['id'] === WEB);

        return JSON.stringify(entry ?? {}).includes('"importing":true') ? entry : undefined;
      },
      120_000,
      1_000,
    ).catch(() => null);

    rec.verdict('background import reported (F3b)', importing !== null);
    rec.verdict('other workload runs during the import (F3b)', Boolean(await n1.containerOf(sidecar.id)));

    await sshReady(vm1, '10.244.1.50').catch(async (error: unknown) => {
      // G5: what the node saw — containers, the launcher's log, the replica's status, the guest's serial console.
      rec.note('containers on vm1', await vm1.exec("docker ps -a --format '{{.Names}} {{.Status}}'").catch(String));
      rec.note(
        'VM launcher log (tail)',
        await vm1
          .exec(`docker logs --tail 40 $(docker ps -aq --filter label=loadweaver.com/workload=${WEB} | head -n1) 2>&1`)
          .catch(String),
      );
      rec.note('VM status', (await n1.status()).workloads.find((w) => w['id'] === WEB) ?? 'none');
      rec.note(
        'serial (tail)',
        (await serialText(n1, WEB, /./, 30_000).catch(String)).split('\n').slice(-40).join('\n'),
      );
      rec.note(
        'agent journal (web / errors)',
        await vm1
          .exec("journalctl -u lw-m7 --no-pager -o cat | grep -E 'web/0|ERROR|WARN|import|Applying' | tail -n 40")
          .catch(String),
      );
      rec.note(
        'docker start of the created launcher',
        await vm1
          .exec(`docker start $(docker ps -aq --filter label=loadweaver.com/workload=${WEB} | head -n1) 2>&1 || true`)
          .catch(String),
      );
      rec.note(
        'vm1 → guest',
        await vm1
          .exec('ip route get 10.244.1.50; ip neigh show 10.244.1.50; ping -c1 -W2 10.244.1.50 | tail -n2')
          .catch(String),
      );
      throw error;
    });
    rec.measure('apply → ssh into the VM (import + boot)', Math.round((Date.now() - start) / 1000), 's');

    const facts = await guest(
      vm1,
      '10.244.1.50',
      'hostname; cat /root/lab-secret; echo; cat /sys/class/net/nic0/mtu; grep ^nameserver /etc/resolv.conf || resolvectl dns nic0; growpart --help >/dev/null 2>&1 && echo growpart; lsblk -b -dn -o NAME,SIZE /dev/vda',
    );

    expect(facts).toContain('web');
    expect(facts).toContain(SECRET_VALUE);
    expect(facts).not.toContain('secret://');
    expect(facts).toMatch(/nameserver|DNS/);

    // The seed lives on tmpfs only; the secret value never touches the node's disks.
    const seedFs = await vm1.exec(
      `findmnt -n -o FSTYPE -T $(dirname $(find /run/loadweaver/vm -maxdepth 3 -name seed -type d | head -n1))`,
    );

    expect(seedFs.trim()).toBe('tmpfs');
    expect(
      (
        await vm1.exec(
          `grep -rIl --exclude-dir=proc --exclude-dir=sys --exclude-dir=run --exclude-dir=dev '${SECRET_VALUE}' / 2>/dev/null | grep -v lab-secrets.json || true`,
        )
      ).trim(),
    ).toBe('');
    expect(
      (await vm1.exec("find / -xdev \\( -name '*cidata*' -o -name 'seed.img' \\) 2>/dev/null || true")).trim(),
    ).toBe('');

    // Import mode: a locked-down job container ran `qemu-img convert` onto the DRBD device.
    expect(
      // (The agent logs "Boot disk <volume> of <replica> written from <digest>".)
      await vm1.exec(
        'journalctl -u lw-m7 --no-pager | grep -iE "boot disk .*web.* written|import(ed)? .*web" | tail -n 3 || true',
      ),
    ).toBeTruthy();
    rec.note('disk tags after the import', await lvTags(vm1, 'lab/lw-vm/web.boot'));
  });

  it('(b) gives the second NIC its own tap and address', async () => {
    if (!nested) return;

    const launcher = await n1.containerOf(WEB);
    const taps = await vm1.exec(
      `pid=$(docker inspect -f '{{.State.Pid}}' ${launcher}); nsenter -t $pid -n ip -o link show | grep -o 'lwtap[0-9]*' | sort -u`,
    );

    expect(taps.trim().split('\n')).toEqual(['lwtap0', 'lwtap1']);
    expect(await guest(vm1, '10.244.1.50', 'ip -o -4 addr show nic1')).toContain('10.244.1.51/32');
    expect(await vm1.exec('ping -c 2 -W 2 10.244.1.51 >/dev/null && echo ok')).toContain('ok');
  });

  it('(c) runs power actions through vm-ctl and reports power states and outcomes', async () => {
    if (!nested) return;

    expect(await power(n1, WEB)).toBe('running');

    const bootId = (await guest(vm1, '10.244.1.50', 'cat /proc/sys/kernel/random/boot_id')).trim();

    await n1.vmMessage('vmPower', { replica: WEB, action: 'reboot' });
    await eventually(
      'rebooted',
      async () => {
        const now = await guest(vm1, '10.244.1.50', 'cat /proc/sys/kernel/random/boot_id').catch(() => bootId);

        return now.trim() !== bootId ? true : undefined;
      },
      300_000,
      5_000,
    );

    await n1.vmMessage('vmPower', { replica: WEB, action: 'reset' });
    await sshReady(vm1, '10.244.1.50');

    // The guest goes down: seen as shutting-down / shut-off, or — the launcher ends with its guest and Docker's restart
    // policy starts it again (on the node alone; the control plane's `shutdown` also stops the replica) — as a restart.
    const restarts = async () =>
      Number((await vm1.exec(`docker inspect -f '{{.RestartCount}}' ${await n1.containerOf(WEB)}`)).trim());
    const restartsBefore = await restarts();

    await n1.vmMessage('vmPower', { replica: WEB, action: 'shutdown' });
    expect(
      await eventually(
        'shut off',
        async () =>
          /shut-off|shutting-down/.test(await power(n1, WEB)) || (await restarts()) > restartsBefore ? true : undefined,
        180_000,
        500,
      ),
    ).toBe(true);

    // destroy ends an ACPI stop at once (force-off).
    await vm1.exec(`docker start ${await n1.containerOf(WEB)} >/dev/null || true`);
    await sshReady(vm1, '10.244.1.50');

    const t0 = Date.now();

    await n1.vmMessage('vmPower', { replica: WEB, action: 'destroy' });
    await eventually(
      'destroyed',
      async () => (/shut-off|unknown|^$/.test(await power(n1, WEB)) ? true : undefined),
      60_000,
      1_000,
    );
    rec.measure('destroy → off', Math.round((Date.now() - t0) / 100) / 10, 's', 10);

    const events = (await n1.messages(0)).filter(
      (m) => m.type === 'event' && JSON.stringify(m.payload).includes('virtual-machine'),
    );

    rec.note(
      'VM events',
      events.map((e) => e.payload),
    );
    expect(events.some((e) => /"result":"(done|running)"/.test(JSON.stringify(e.payload)))).toBe(true);

    // A power action on a VM that doesn't run here fails with an explicit action label (F3b).
    await n2.vmMessage('vmPower', { replica: WEB, action: 'reboot' });

    const failed = await n2.waitMessage(
      'vmPower failure event',
      (m) => m.type === 'event' && JSON.stringify(m.payload).includes('failed'),
    );

    rec.verdict(
      'failure event carries the action (F3b)',
      JSON.stringify(failed.payload).includes('"action":"reboot"'),
      JSON.stringify(failed.payload),
    );
    await vm1.exec(`docker start ${await n1.containerOf(WEB)} >/dev/null || true`);
    await sshReady(vm1, '10.244.1.50');
  });

  it('(d) fails over: the disk is promoted on vm2 and adopted (not re-imported), the VM keeps its data', async () => {
    if (!nested) return;

    await guest(vm1, '10.244.1.50', 'echo before-failover > /root/marker && sync');
    await rec.time('vm1 crash', () => vm1.crash());

    const moved = vmVolumes(web, [vm1, vm2], vm2, { minor: 1200, port: 7950 });
    const start = Date.now();

    await n2.apply({ workloads: [vmWorkload(web)], volumes: moved, network: podNetwork(SUBNET) });
    await sshReady(vm2, '10.244.1.50');
    rec.measure('failover → ssh on vm2', Math.round((Date.now() - start) / 1000), 's');
    expect((await guest(vm2, '10.244.1.50', 'cat /root/marker')).trim()).toBe('before-failover');
    expect(await vm2.exec('journalctl -u lw-m7 --no-pager | grep -ciE "convert|importing" || true')).toMatch(/^0/);
    rec.note('vm2 disk tags', await lvTags(vm2, 'lab/lw-vm/web.boot'));

    await vm1.start();
    await restartNodeDriver(vm1);
    await n1.apply({ workloads: [], volumes: moved, network: podNetwork(SUBNET) });
  });

  it('(e) re-imports after the agent was killed mid-import', async () => {
    if (!nested) return;

    const db: LabVmOptions = {
      ...web,
      name: 'db',
      nics: [{ name: 'nic0', addresses: ['10.244.1.60'] }],
      userData: undefined,
      secretRefs: [],
    };
    const volumes = vmVolumes(db, [vm1], vm1, { minor: 1210, port: 7960 });

    await n1.apply({ workloads: [vmWorkload(db)], volumes, network: podNetwork(SUBNET) });
    // The import of a one-replica disk takes ~20 s here: watch the agent's status (as (a)) and kill at once.
    await eventually(
      'import running',
      async () =>
        JSON.stringify((await n1.status()).workloads.find((w) => w['id'] === 'lab/lw-vm/db/0') ?? {}).includes(
          '"importing":true',
        )
          ? true
          : undefined,
      300_000,
      200,
    ).catch(async (error: unknown) => {
      rec.note('lvs', await vm1.exec('lvs --noheadings -o lv_name,lv_tags 2>&1 || true').catch(String));
      rec.note('db status', (await n1.status()).workloads.find((w) => w['id'] === 'lab/lw-vm/db/0') ?? 'none');
      rec.note(
        'agent journal (db / errors)',
        await vm1
          .exec("journalctl -u lw-m7 --no-pager -o cat | grep -E 'db|ERROR|WARN|Boot disk|import' | tail -n 30")
          .catch(String),
      );
      throw error;
    });
    rec.note('db disk tags before the kill', await lvTags(vm1, 'lab/lw-vm/db.boot'));
    await vm1.exec('systemctl kill -s SIGKILL lw-m7; sleep 2');
    rec.note('db disk tags after the kill', await lvTags(vm1, 'lab/lw-vm/db.boot'));
    await restartNodeDriver(vm1);
    await n1.apply({ workloads: [vmWorkload(db)], volumes, network: podNetwork(SUBNET) });
    await sshReady(vm1, '10.244.1.60');
    expect(await vm1.exec('lvs --noheadings -o lv_tags 2>/dev/null | grep -c lw.importing || true')).toMatch(/^0/);
    await n1.apply({ workloads: [], volumes, network: podNetwork(SUBNET) });
  });

  it('(f) reimages a stopped VM', async () => {
    if (!nested) return;

    const vm = {
      ...web,
      name: 'cache',
      nics: [{ name: 'nic0', addresses: ['10.244.1.70'] }],
      userData: undefined,
      secretRefs: [],
    };
    const volumes = vmVolumes(vm, [vm1], vm1, { minor: 1220, port: 7970 });
    const running = vmWorkload(vm);

    await n1.apply({ workloads: [running], volumes, network: podNetwork(SUBNET) });
    await sshReady(vm1, '10.244.1.70');
    await guest(vm1, '10.244.1.70', 'echo old-data > /root/marker && sync');

    // Stopped the control plane's way: the replica leaves the node (its disks stay) — the control plane always sends
    // `power: 'running'` and stops a VM by not placing it (vm-planning.utils.ts).
    await n1.apply({ workloads: [], volumes, network: podNetwork(SUBNET) });
    await eventually(
      'stopped',
      async () =>
        (await vm1.exec(`docker ps -q --filter label=loadweaver.com/workload=${running.id}`)).trim() === ''
          ? true
          : undefined,
      180_000,
      3_000,
    );

    const importId = '6f1c2b8e-3d4a-4b5c-9e7f-0a1b2c3d4e5f';

    await n1.vmMessage('vmImageImport', {
      import: importId,
      replica: running.id,
      volume: 'lab/lw-vm/cache.boot',
      image: (running.vm as NonNullable<WorkloadSpec['vm']>).image,
    });
    await n1.waitMessage(
      'reimage done',
      (m) =>
        m.type === 'event' &&
        JSON.stringify(m.payload).includes(importId) &&
        /"result":"done"/.test(JSON.stringify(m.payload)),
      900_000,
    );

    // A new cloud-init generation comes with a reimage (W8): the control plane bumps the instance id.
    await n1.apply({ workloads: [vmWorkload({ ...vm, instanceGeneration: 2 })], volumes, network: podNetwork(SUBNET) });
    await sshReady(vm1, '10.244.1.70');
    expect((await guest(vm1, '10.244.1.70', 'cat /root/marker 2>/dev/null || echo fresh')).trim()).toBe('fresh');
    await n1.apply({ workloads: [], volumes, network: podNetwork(SUBNET) });
  });

  it('(g) boots raw+zstd and KubeVirt containerDisk images', async () => {
    if (!nested) return;

    const disk = await downloadDebianCloudImage(vm1);

    await vm1.exec(`qemu-img convert -O raw ${disk} /var/tmp/debian-13.raw`, { timeoutMs: 900_000 });

    const raw = await pushVmArtifact(vm1, registry, 'lab/debian-raw', '13', {
      path: '/var/tmp/debian-13.raw',
      format: 'raw',
    });
    const cd = (
      await vm1.exec(
        [
          'd=$(mktemp -d) && cp /var/tmp/debian-13.qcow2 $d/debian.qcow2',
          "printf 'FROM scratch\\nADD --chown=107:107 debian.qcow2 /disk/\\n' > $d/Dockerfile",
          `docker build -q -t ${registry}/lab/containerdisk:13 $d >/dev/null && docker push -q ${registry}/lab/containerdisk:13 >/dev/null`,
          `curl -sS --cacert ${LAB_CA_FILE} -D /tmp/h -H 'Accept: application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json' https://${registry}/v2/lab/containerdisk/manifests/13 -o /tmp/m`,
          `python3 -c 'import json;m=json.load(open("/tmp/m"));print(m["layers"][-1]["digest"])'`,
          "sed -n 's/^[Dd]ocker-[Cc]ontent-[Dd]igest: //p' /tmp/h | tr -d '\\r'",
        ].join('\n'),
        { timeoutMs: 1_800_000 },
      )
    )
      .trim()
      .split('\n');
    const containerDisk: PushedVmImage = {
      ref: `${registry}/lab/containerdisk:13`,
      digest: cd[1],
      layerDigest: cd[0],
      format: 'qcow2',
      virtualSize: qcow2.virtualSize,
    };

    for (const [label, image, ip, minor] of [
      ['raw', raw, '10.244.1.80', 1230],
      ['containerdisk', containerDisk, '10.244.1.81', 1240],
    ] as const) {
      const vm = {
        ...web,
        name: label,
        image,
        nics: [{ name: 'nic0', addresses: [ip] }],
        userData: undefined,
        secretRefs: [],
        disks: [web.disks[0]],
      };
      const volumes = vmVolumes(vm, [vm1], vm1, { minor, port: 6000 + minor });

      await n1.apply({ workloads: [vmWorkload(vm)], volumes, network: podNetwork(SUBNET) });
      await rec.time(`${label} image → ssh`, () => sshReady(vm1, ip));
      expect(await serialText(n1, `lab/lw-vm/${label}/0`, /login:|Debian/, 60_000)).toBeTruthy();
      await n1.apply({ workloads: [], volumes, network: podNetwork(SUBNET) });
    }
  });

  it('(h) queues a third boot-disk import (concurrency 2) and cancels running imports when the VMs go (F3b)', async () => {
    if (!nested) return;

    const names = ['q1', 'q2', 'q3'];
    const vms = names.map((name, i) => ({
      ...web,
      name,
      memoryMiB: 256,
      nics: [{ name: 'nic0', addresses: [`10.244.1.${90 + i}`] }],
      userData: undefined,
      secretRefs: [],
      disks: [web.disks[0]],
    }));
    const volumes = vms.flatMap((vm, i) => vmVolumes(vm, [vm1], vm1, { minor: 1250 + i, port: 7990 + i }));
    const phase = async (name: string) =>
      String(
        (
          ((await n1.status()).workloads.find((w) => w['id'] === `lab/lw-vm/${name}/0`)?.['vm'] ?? {}) as {
            importProgress?: { phase?: string };
          }
        ).importProgress?.phase ?? '',
      );

    await n1.apply({ workloads: vms.map((vm) => vmWorkload(vm)), volumes, network: podNetwork(SUBNET) });

    const phases = await eventually(
      'two writing / fetching, one queued',
      async () => {
        const p = await Promise.all(names.map(phase));

        return p.filter((x) => x === 'queued').length === 1 && p.filter((x) => /fetching|writing/.test(x)).length === 2
          ? p
          : undefined;
      },
      300_000,
      1_000,
    ).catch(async () => Promise.all(names.map(phase)));

    rec.note('import phases of three VMs', phases);
    rec.verdict('the third import waits (LOADWEAVER_VM_IMPORT_CONCURRENCY default 2)', phases.includes('queued'));

    // The VMs go mid-import: running imports are killed, the disks demoted (never left primary).
    await n1.apply({ workloads: [], volumes, network: podNetwork(SUBNET) });
    await eventually(
      'import jobs gone',
      async () =>
        (
          await vm1.exec("docker ps -q | xargs -r docker inspect -f '{{.Config.Cmd}}' | grep -c qemu-img || true")
        ).trim() === '0'
          ? true
          : undefined,
      120_000,
      2_000,
    );
    expect(await vm1.exec('drbdadm role all 2>/dev/null | grep -c Primary || true')).toMatch(/^0/);
    await n1.apply({ workloads: [], volumes: [], network: podNetwork(SUBNET) });
  });

  it('(i) reports a failing import (bad layer digest) as failed with an event and retries (F3b)', async () => {
    if (!nested) return;

    const bad = {
      ...web,
      name: 'broken',
      memoryMiB: 256,
      nics: [{ name: 'nic0', addresses: ['10.244.1.99'] }],
      userData: undefined,
      secretRefs: [],
      disks: [web.disks[0]],
      image: { ...qcow2, layerDigest: `sha256:${'0'.repeat(64)}` },
    };
    const volumes = vmVolumes(bad, [vm1], vm1, { minor: 1260, port: 8010 });

    await n1.apply({ workloads: [vmWorkload(bad)], volumes, network: podNetwork(SUBNET) });

    const failed = await eventually(
      'import failed in the status',
      async () => {
        const entry = (await n1.status()).workloads.find((w) => w['id'] === 'lab/lw-vm/broken/0');

        return entry && JSON.stringify(entry).includes('"phase":"failed"') ? entry : undefined;
      },
      300_000,
      2_000,
    );

    rec.note('failed import status', failed);

    const event = await n1.waitMessage(
      'boot-disk import failure event',
      (m) =>
        m.type === 'event' &&
        /boot-disk-import/.test(JSON.stringify(m.payload)) &&
        /"result":"failed"/.test(JSON.stringify(m.payload)),
      120_000,
    );

    expect(JSON.stringify(event.payload)).toMatch(/broken/);
    await n1.apply({ workloads: [], volumes: [], network: podNetwork(SUBNET) });
  });
});
