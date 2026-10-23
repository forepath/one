import { LabRecorder } from '@forepath/shared/backend/util-vm-lab';
import {
  MICROVM_EXEC_CLIENT_PATH,
  MICROVM_LAUNCHER_CAPABILITIES,
  MICROVM_LAUNCHER_OVERHEAD_MIB,
} from '@forepath/shared/backend/util-microvm-bridge';
import type { WorkloadSpec } from '@forepath/loadweaver/shared/util-agent-protocol';

import { startVmLab, type Vm, type VmLab } from '../vm-lab';

import {
  AGENSTRA_MICROVM_IMAGE,
  eventually,
  genericMicrovm,
  hasLocalImage,
  IMAGE_HINTS,
  inspectHubImage,
  type InspectedImage,
  LAB_CA_FILE,
  LAUNCHER_IMAGE,
  loadImages,
  log,
  nestedDescribe,
  type NodeDriver,
  podNetwork,
  requireImages,
  requireNested,
  restartNodeDriver,
  sleep,
  startLabRegistry,
  startNodeDriver,
  trustLabRegistry,
  workload,
} from './m7-lab';

/**
 * MicroVMs on real kernels (M7 W6 + F1, 3.35): the node agent's microVM side (M7 node driver: real `RootfsCache`,
 * confined layer unpack, `GuestNetwork` taps + tc redirect, `WorkloadManager` launcher options, the shared launcher of
 * this tree) on vm1 (nested KVM, thin pool on its data disk); vm2 (no nesting) runs an ordinary container on its own
 * pod subnet, routed like BIRD would.
 *
 * (a) generic microVMs from alpine (musl) and `debian:trixie-slim` (no node in the image): entrypoint / cmd / env /
 *     user / workdir as the image config + overrides say, stdout in `docker logs`, boot time recorded, launcher
 *     hardening (runc, caps, no-new-privileges, read-only root, pids, memory = guest + overhead); (b) exit code
 *     propagation (`exit 7` → container exit 7 → `on-failure` restart), SIGTERM within the grace, a health check through
 *     `vm-exec`; (c) networking: the guest owns the workload IP (reachable from vm2's container and, hairpin, from a
 *     container on vm1), MTU (`ping -M do`), spoofing dropped (a neighbour's IP added in the guest, a forged MAC);
 *     (d) unpack cache: two replicas share one layer directory, GC after delete; whiteouts / opaque dirs / setuid
 *     preserved in the guest, overlay `nosuid,nodev,noexec` on the host; a malicious layer (`..`, symlink escape,
 *     device node) is refused; (e) multi-arch: `platformLayers` picks amd64, an arm64-only image is refused with
 *     `E_MICROVM_IMAGE_UNSUPPORTED`; (f) restart after a node reboot (overlay remounted, writable layer kept);
 *     (g) a bundled microVM (Agenstra's lab image) boots in bundled mode (optional: needs the image).
 * Not here: network policy deny between guests (the driver has no firewall layer; the compiler's per-NIC policy
 * members are unit-tested), IPv6 guests (the lab's pod networks are IPv4).
 */

const SUBNET_1 = '10.244.1.0/24';
const SUBNET_2 = '10.244.2.0/24';

nestedDescribe('microVMs')('microVMs on real kernels (VM lab, M7 W6 / F1)', () => {
  let lab: VmLab;
  let vm1: Vm;
  let vm2: Vm;
  let n1: NodeDriver;
  let n2: NodeDriver;
  let nested = false;
  let registry = '';
  let alpine: InspectedImage;
  let debian: InspectedImage;
  const rec = new LabRecorder('m7-microvm');
  const desired1: WorkloadSpec[] = [];

  const apply1 = (workloads: WorkloadSpec[]) => {
    desired1.splice(0, desired1.length, ...workloads);

    return n1.apply({ workloads, network: podNetwork(SUBNET_1) });
  };
  const launcherOf = (replica: string) =>
    eventually(`launcher of ${replica}`, async () => (await n1.containerOf(replica)) || undefined);
  const guest = (replica: string, script: string) => n1.exec(replica, ['/bin/sh', '-c', script]);
  const waitLog = (container: string, pattern: RegExp, timeoutMs = 240_000) =>
    eventually(
      `${pattern} in ${container}`,
      async () => (await vm1.exec(`docker logs ${container} 2>&1`)).match(pattern)?.[0],
      timeoutMs,
      1_000,
    );

  /** Pushes a locally built image (Dockerfile on vm1) to the lab registry and inspects it from the registry. */
  const buildAndPush = async (name: string, dockerfile: string): Promise<InspectedImage> => {
    const ref = `${registry}/lab/${name}:1`;
    const out = await vm1.exec(
      [
        `d=$(mktemp -d) && cat > $d/Dockerfile <<'LWEOF'\n${dockerfile}\nLWEOF`,
        `docker build -q -t ${ref} $d >/dev/null && docker push -q ${ref} >/dev/null`,
        `curl -sS --cacert ${LAB_CA_FILE} -H 'Accept: application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json' https://${registry}/v2/lab/${name}/manifests/1 -D /tmp/h -o /tmp/m`,
        `cfg=$(python3 -c 'import json;print(json.load(open("/tmp/m"))["config"]["digest"])')`,
        `curl -sS --cacert ${LAB_CA_FILE} https://${registry}/v2/lab/${name}/blobs/$cfg -o /tmp/c`,
        `python3 - <<'PY'\nimport json\nm=json.load(open('/tmp/m'));c=json.load(open('/tmp/c'))\nd=[l.split(': ')[1].strip() for l in open('/tmp/h') if l.lower().startswith('docker-content-digest')][0]\ncc=c.get('config') or {}\nprint(json.dumps({'digest':d,'layers':[{'digest':l['digest'],'size':l['size'],'mediaType':l['mediaType'],'diffId':c['rootfs']['diff_ids'][i]} for i,l in enumerate(m['layers'])],'process':{'entrypoint':cc.get('Entrypoint') or [],'cmd':cc.get('Cmd') or [],'env':cc.get('Env') or [],'user':cc.get('User') or '','workingDir':cc.get('WorkingDir') or '/','stopSignal':cc.get('StopSignal') or 'SIGTERM'}}))\nPY`,
      ].join('\n'),
      { timeoutMs: 900_000 },
    );
    const parsed = JSON.parse(out.trim().split('\n').pop() as string) as {
      digest: string;
      layers: InspectedImage['layers'];
      process: InspectedImage['process'];
    };

    return {
      pinned: `${registry}/lab/${name}@${parsed.digest}`,
      layers: parsed.layers,
      process: parsed.process,
      labels: {},
    };
  };

  beforeAll(async () => {
    await requireImages({ [LAUNCHER_IMAGE]: IMAGE_HINTS[LAUNCHER_IMAGE] });
    [alpine, debian] = await Promise.all([inspectHubImage('alpine:3.22'), inspectHubImage('debian:trixie-slim')]);
    lab = await rec.time('lab up', () =>
      startVmLab({
        vms: [
          { name: 'vm1', site: 'a', memoryMb: 3072, cpus: 3, nested: true, dataDiskGb: 8 },
          { name: 'vm2', site: 'a', memoryMb: 1024, cpus: 1, nested: false },
        ],
        packages: ['attr', 'python3'],
        log,
      }),
    );
    ({ vm1, vm2 } = lab.vms as Record<'vm1' | 'vm2', Vm>);
    nested = await requireNested(vm1, 'microVMs');

    if (!nested) return;

    await loadImages(vm1, [LAUNCHER_IMAGE]);

    const reg = await startLabRegistry(vm1);

    registry = reg.host;
    await trustLabRegistry(vm2, registry, reg.ca);
    [n1, n2] = await Promise.all([
      startNodeDriver(vm1, { storage: true, labCa: reg.ca }),
      startNodeDriver(vm2, { labCa: reg.ca }),
    ]);
    // BIRD's routes, statically: each node's pod subnet via the node.
    await vm1.exec(`ip route replace ${SUBNET_2} via ${vm2.ip}`);
    await vm2.exec(`ip route replace ${SUBNET_1} via ${vm1.ip}`);
    await n2.apply({
      workloads: [workload({ id: 'lab/peer/client/0', addresses: ['10.244.2.10'], command: ['sleep', '1000000'] })],
      network: podNetwork(SUBNET_2),
    });
  }, 3_600_000);

  afterAll(async () => {
    rec.flush();
    await lab?.stop();
  }, 300_000);

  it('(a) boots generic microVMs from alpine and debian:trixie-slim with the image process, hardened launcher', async () => {
    if (!nested) return;

    const a = genericMicrovm({ id: 'lab/mv/alpine/0', addresses: ['10.244.1.20'] }, alpine, {
      process: {
        entrypoint: ['/bin/sh', '-c'],
        cmd: ['echo "hello $LW_GREETING from $(id -un) in $(pwd)"; exec sleep 1000000'],
        env: ['LW_GREETING=lab', 'PATH=/usr/sbin:/usr/bin:/sbin:/bin'],
        user: 'nobody',
        workingDir: '/tmp',
      },
    });
    const d = genericMicrovm({ id: 'lab/mv/debian/0', addresses: ['10.244.1.21'] }, debian, {
      process: { cmd: ['bash', '-c', 'echo debian-guest $(cat /etc/debian_version); exec sleep 1000000'] },
    });
    const start = Date.now();

    await apply1([a, d]);

    const la = await launcherOf(a.id);

    expect(await waitLog(la, /hello lab from nobody in \/tmp/)).toBeTruthy();
    rec.measure('alpine microVM apply → first log line', Math.round((Date.now() - start) / 100) / 10, 's', 30);

    const ld = await launcherOf(d.id);

    expect(await waitLog(ld, /debian-guest 13/)).toBeTruthy();
    rec.measure('debian microVM apply → first log line', Math.round((Date.now() - start) / 100) / 10, 's', 45);

    const inspect = JSON.parse(await vm1.exec(`docker inspect ${la}`))[0];

    expect(inspect.HostConfig.Runtime).toBe('runc');
    expect(inspect.HostConfig.CapDrop).toEqual(['ALL']);
    expect([...inspect.HostConfig.CapAdd].sort()).toEqual([...MICROVM_LAUNCHER_CAPABILITIES].sort());
    expect(inspect.HostConfig.SecurityOpt).toContain('no-new-privileges');
    expect(inspect.HostConfig.ReadonlyRootfs).toBe(true);
    expect(inspect.HostConfig.PidsLimit).toBe(1024);
    expect(inspect.HostConfig.Memory).toBe((256 + MICROVM_LAUNCHER_OVERHEAD_MIB) * 1024 ** 2);
    expect(inspect.Config.Labels['loadweaver.com/microvm']).toBe('generic');
    // The guest's kernel is not the node's.
    expect((await guest(a.id, 'uname -r')).text.trim()).not.toBe((await vm1.exec('uname -r')).trim());
  });

  it('(b) propagates exit codes, stops within the grace on SIGTERM and runs health checks through vm-exec', async () => {
    if (!nested) return;

    const failing = genericMicrovm({ id: 'lab/mv/exit/0', addresses: ['10.244.1.22'], restart: 'on-failure' }, alpine, {
      process: { entrypoint: ['/bin/sh', '-c'], cmd: ['echo started; sleep 2; exit 7'] },
    });
    const healthy = genericMicrovm(
      {
        id: 'lab/mv/health/0',
        addresses: ['10.244.1.23'],
        stopGracePeriodMs: 20_000,
        healthcheck: {
          test: ['CMD', MICROVM_EXEC_CLIENT_PATH, '--', '/bin/sh', '-c', 'test -f /tmp/ready'],
          intervalMs: 2_000,
          timeoutMs: 10_000,
          retries: 3,
          startPeriodMs: 30_000,
        },
      },
      alpine,
      {
        process: {
          entrypoint: ['/bin/sh', '-c'],
          cmd: ["trap 'echo got-term; exit 0' TERM; touch /tmp/ready; while true; do sleep 1; done"],
        },
      },
    );

    await apply1([...desired1, failing, healthy]);

    const since = Math.floor(Date.now() / 1000) - 5;
    const lf = await launcherOf(failing.id);
    const exits = await eventually(
      'exit 7 and a restart',
      async () => {
        const codes = (
          await vm1.exec(
            `docker events --since ${since} --until $(date +%s) --filter container=${lf} --filter event=die --format '{{index .Actor.Attributes "exitCode"}}'`,
          )
        )
          .split('\n')
          .filter(Boolean);
        const count = Number((await vm1.exec(`docker inspect -f '{{.RestartCount}}' ${lf}`)).trim());

        return count >= 1 && codes.length > 0 ? codes : undefined;
      },
      300_000,
      2_000,
    );

    expect(exits[0]).toBe('7');

    const lh = await launcherOf(healthy.id);

    expect(
      await eventually(
        'healthy',
        async () =>
          (await vm1.exec(`docker inspect -f '{{.State.Health.Status}}' ${lh}`)).trim() === 'healthy'
            ? true
            : undefined,
        240_000,
        2_000,
      ),
    ).toBe(true);

    const t0 = Date.now();

    await vm1.exec(`docker stop -t 25 ${lh} >/dev/null`, { timeoutMs: 120_000 });
    rec.measure('SIGTERM → launcher stopped', Math.round((Date.now() - t0) / 100) / 10, 's', 20);
    expect(await vm1.exec(`docker logs ${lh} 2>&1`)).toContain('got-term');
    expect((await vm1.exec(`docker inspect -f '{{.State.ExitCode}}' ${lh}`)).trim()).toBe('0');
    await vm1.exec(`docker start ${lh} >/dev/null`);
  });

  it('(c) gives the guest the workload IP: reachable across nodes and hairpin, MTU, spoofing dropped', async () => {
    if (!nested) return;

    const replica = 'lab/mv/alpine/0';
    const client2 = await n2.containerOf('lab/peer/client/0');

    // vm2's container → the guest on vm1 (routed), and a container on vm1 → the guest (hairpin through lwbr0).
    expect(await vm2.exec(`docker exec ${client2} ping -c 2 -W 2 10.244.1.20 >/dev/null && echo ok`)).toContain('ok');
    await apply1([
      ...desired1,
      workload({ id: 'lab/peer/local/0', addresses: ['10.244.1.30'], command: ['sleep', '1000000'] }),
    ]);

    const local = await eventually(
      'local container',
      async () => (await n1.containerOf('lab/peer/local/0')) || undefined,
    );

    expect(await vm1.exec(`docker exec ${local} ping -c 2 -W 2 10.244.1.20 >/dev/null && echo ok`)).toContain('ok');

    // MTU: the guest's interface MTU passes unfragmented, one byte more doesn't.
    const mtu = Number((await guest(replica, 'cat /sys/class/net/eth0/mtu')).text.trim());

    rec.note('guest MTU', mtu);
    expect(
      (await guest(replica, `ping -c 1 -W 2 -M do -s ${mtu - 28} 10.244.2.10 >/dev/null; echo rc=$?`)).text,
    ).toContain('rc=0');
    expect(
      (await guest(replica, `ping -c 1 -W 2 -M do -s ${mtu - 27} 10.244.2.10 >/dev/null 2>&1; echo rc=$?`)).text,
    ).not.toContain('rc=0');

    // Spoofing: a neighbour's address and a forged MAC never leave the tap.
    await guest(replica, 'ip addr add 10.244.1.21/32 dev eth0; true');
    expect(
      (await guest(replica, 'ping -c 2 -W 2 -I 10.244.1.21 10.244.2.10 >/dev/null 2>&1; echo rc=$?')).text,
    ).not.toContain('rc=0');
    await guest(replica, 'ip addr del 10.244.1.21/32 dev eth0; ip link set eth0 address 52:54:00:de:ad:01; true');
    expect((await guest(replica, 'ping -c 2 -W 2 10.244.2.10 >/dev/null 2>&1; echo rc=$?')).text).not.toContain('rc=0');

    const drops = await vm1.exec(
      `pid=$(docker inspect -f '{{.State.Pid}}' ${await n1.containerOf(replica)}); nsenter -t $pid -n tc -s filter show dev lwtap0 ingress | grep -A3 'prio 99' | grep -o 'Sent [0-9]* bytes [0-9]* pkt' | head -n1`,
    );

    rec.note('tap drops (prio 99)', drops.trim());
    expect(drops).toMatch(/Sent [1-9]/);
    // Back to the real MAC (the spec's) for the next cases.
    await vm1.exec(`docker restart ${await n1.containerOf(replica)} >/dev/null`);
  });

  it('(d) shares unpacked layers, keeps whiteouts / opaque dirs / setuid, mounts noexec on the host, refuses malicious layers', async () => {
    if (!nested) return;

    const layered = await buildAndPush(
      'layered',
      [
        `FROM ${alpine.pinned}`,
        'RUN mkdir -p /opq && touch /opq/old /gone && cp /bin/busybox /usr/local/bin/suid && chmod 4755 /usr/local/bin/suid',
        'RUN rm -f /gone && rm -rf /opq && mkdir /opq && touch /opq/new',
      ].join('\n'),
    );
    const first = genericMicrovm({ id: 'lab/mv/layered/0', addresses: ['10.244.1.24'] }, layered, {
      process: { entrypoint: ['/bin/sh', '-c'], cmd: ['sleep 1000000'] },
    });
    const second = genericMicrovm({ id: 'lab/mv/layered/1', addresses: ['10.244.1.25'] }, layered, {
      process: { entrypoint: ['/bin/sh', '-c'], cmd: ['sleep 1000000'] },
    });

    await apply1([...desired1, first, second]);
    await launcherOf(first.id);
    await launcherOf(second.id);

    const view = (
      await guest(
        first.id,
        'ls /opq; test -e /gone && echo gone-present || echo gone-absent; stat -c %a /usr/local/bin/suid',
      )
    ).text;

    expect(view).toContain('new');
    expect(view).not.toContain('old');
    expect(view).toContain('gone-absent');
    expect(view).toContain('4755');

    // One directory per layer diffID, shared by both replicas.
    for (const layer of layered.layers)
      expect(
        (await vm1.exec(`ls -d /var/lib/loadweaver/vmroot/layers/sha256/${layer.diffId.slice(7)} | wc -l`)).trim(),
      ).toBe('1');

    const mounts = await vm1.exec("findmnt -rn -t overlay -o TARGET,OPTIONS | grep '/run/loadweaver/vmroot/' || true");

    expect(mounts.split('\n').filter(Boolean).length).toBeGreaterThanOrEqual(2);

    for (const line of mounts.split('\n').filter(Boolean)) expect(line).toMatch(/nosuid.*nodev.*noexec|noexec.*nosuid/);

    // GC: delete both replicas → the layers are no longer mounted / desired and go.
    await apply1(desired1.filter((w) => !w.id.startsWith('lab/mv/layered/')));
    await eventually(
      'layers collected',
      async () => {
        await n1.apply({ workloads: desired1, network: podNetwork(SUBNET_1) });

        return (
          (
            await vm1.exec(
              `ls /var/lib/loadweaver/vmroot/layers/sha256/ | grep -c ${layered.layers[layered.layers.length - 1].diffId.slice(7, 19)} || true`,
            )
          ).trim() === '0'
        );
      },
      300_000,
      10_000,
    ).catch((error: unknown) => rec.verdict('layer GC after delete', false, String(error)));

    // A malicious layer: `..` entry, a symlink escaping the root followed by a write through it, a device node.
    const evil = (
      await vm1.exec(
        [
          `python3 - <<'PY'\nimport io,tarfile,hashlib,json\nb=io.BytesIO()\nt=tarfile.open(fileobj=b,mode='w')\ndef add(name,**kw):\n  i=tarfile.TarInfo(name);[setattr(i,k,v) for k,v in kw.items()];t.addfile(i,io.BytesIO(b'x') if i.type==tarfile.REGTYPE else None)\nadd('esc',type=tarfile.SYMTYPE,linkname='/etc')\ni=tarfile.TarInfo('esc/lw-pwned');i.size=1;t.addfile(i,io.BytesIO(b'x'))\ni=tarfile.TarInfo('../outside');i.size=1;t.addfile(i,io.BytesIO(b'x'))\nadd('dev',type=tarfile.CHRTYPE,devmajor=1,devminor=3)\nt.close();data=b.getvalue()\nopen('/tmp/evil.tar','wb').write(data)\nd=hashlib.sha256(data).hexdigest()\nprint(json.dumps({'digest':'sha256:'+d,'size':len(data)}))\nPY`,
        ].join('\n'),
      )
    ).trim();
    const { digest, size } = JSON.parse(evil) as { digest: string; size: number };

    await vm1.exec(
      [
        `loc=$(curl -sSf --cacert ${LAB_CA_FILE} -X POST -D - -o /dev/null https://${registry}/v2/lab/evil/blobs/uploads/ | sed -n 's/^[Ll]ocation: //p' | tr -d '\\r')`,
        `case "$loc" in http*) ;; *) loc="https://${registry}$loc" ;; esac`,
        'case "$loc" in *\\?*) sep="&" ;; *) sep="?" ;; esac',
        `curl -sSf --cacert ${LAB_CA_FILE} -X PUT --data-binary @/tmp/evil.tar "$loc\${sep}digest=${digest}" >/dev/null`,
      ].join('\n'),
    );

    const malicious = genericMicrovm(
      { id: 'lab/mv/evil/0', addresses: ['10.244.1.26'] },
      {
        ...alpine,
        pinned: `${registry}/lab/evil@${digest}`,
        layers: [{ digest, diffId: digest, size, mediaType: 'application/vnd.oci.image.layer.v1.tar' }],
      },
    );

    await apply1([...desired1, malicious]).catch(() => undefined);

    const refused = await eventually(
      'malicious layer refused',
      async () => {
        const entry = (await n1.status()).workloads.find((w) => w['id'] === malicious.id);

        return entry && /refus|escape|invalid|unsafe|\.\./i.test(JSON.stringify(entry)) ? entry : undefined;
      },
      240_000,
      3_000,
    );

    rec.note('malicious layer status', refused);
    expect(await vm1.exec('test -e /etc/lw-pwned && echo PWNED || echo clean')).toContain('clean');
    expect(await vm1.exec('test -e /var/lib/loadweaver/vmroot/outside && echo PWNED || echo clean')).toContain('clean');
    await apply1(desired1.filter((w) => w.id !== malicious.id));
  });

  it('(e) unpacks the node architecture of a multi-arch image and refuses an image without it', async () => {
    if (!nested) return;

    const arm = await inspectHubImage('alpine:3.22', 'arm64');
    const multi = genericMicrovm({ id: 'lab/mv/multi/0', addresses: ['10.244.1.27'] }, alpine, {
      platformLayers: { amd64: alpine.layers, arm64: arm.layers },
      process: { entrypoint: ['/bin/sh', '-c'], cmd: ['echo arch=$(uname -m); exec sleep 1000000'] },
    });
    const armOnly = genericMicrovm({ id: 'lab/mv/armonly/0', addresses: ['10.244.1.28'] }, arm, {
      platformLayers: { arm64: arm.layers },
    });

    await apply1([...desired1, multi, armOnly]).catch(() => undefined);
    expect(await waitLog(await launcherOf(multi.id), /arch=x86_64/)).toBeTruthy();

    for (const layer of arm.layers)
      expect(
        (
          await vm1.exec(
            `test -d /var/lib/loadweaver/vmroot/layers/sha256/${layer.diffId.slice(7)} && echo yes || echo no`,
          )
        ).trim(),
      ).toBe('no');

    const refused = await eventually(
      'arm64-only refused',
      async () => {
        const entry = (await n1.status()).workloads.find((w) => w['id'] === armOnly.id);

        return entry && JSON.stringify(entry).includes('E_MICROVM_IMAGE_UNSUPPORTED') ? entry : undefined;
      },
      120_000,
      3_000,
    );

    expect(JSON.stringify(refused)).toMatch(/no amd64 variant/);
    await apply1(desired1.filter((w) => w.id !== armOnly.id && w.id !== multi.id));
  });

  it('(f) restarts microVMs after a node reboot with the writable layer kept', async () => {
    if (!nested) return;

    const replica = 'lab/mv/debian/0';

    await guest(replica, 'echo kept > /root/marker && sync');
    await rec.time('vm1 reboot', () => vm1.reboot());
    await restartNodeDriver(vm1);
    await vm1.exec(`ip route replace ${SUBNET_2} via ${vm2.ip}`);
    await n1.apply({ workloads: desired1, network: podNetwork(SUBNET_1) });
    await waitLog(await launcherOf(replica), /debian-guest 13/);
    expect((await guest(replica, 'cat /root/marker')).text.trim()).toBe('kept');
  });

  it('(g) boots a bundled microVM (Agenstra lab image) in bundled mode', async () => {
    if (!nested) return;

    if (!(await hasLocalImage(AGENSTRA_MICROVM_IMAGE))) {
      rec.verdict(
        'bundled microVM',
        false,
        `skipped: ${AGENSTRA_MICROVM_IMAGE} missing (${IMAGE_HINTS[AGENSTRA_MICROVM_IMAGE]})`,
      );

      return;
    }

    await loadImages(vm1, [AGENSTRA_MICROVM_IMAGE]);

    const bundled = workload({
      id: 'lab/mv/bundled/0',
      addresses: ['10.244.1.40'],
      image: AGENSTRA_MICROVM_IMAGE,
      command: undefined,
      isolation: 'microvm',
      resources: { cpuMillis: 1000, memoryBytes: 512 * 1024 ** 2 },
      microvm: { mode: 'bundled', vcpus: 1, memoryMiB: 512, rootfsBytes: 2 * 1024 ** 3 },
    });

    await apply1([...desired1, bundled]);

    const launcher = await launcherOf(bundled.id);

    expect(await waitLog(launcher, /lab-workload-started/, 300_000)).toBeTruthy();
    expect(
      await vm1.exec(`docker inspect -f '{{index .Config.Labels "loadweaver.com/microvm"}}' ${launcher}`),
    ).toContain('bundled');
    expect((await n1.exec(bundled.id, ['id', '-u'])).exitCode).toBe(0);
    await sleep(1_000);
  });
});
