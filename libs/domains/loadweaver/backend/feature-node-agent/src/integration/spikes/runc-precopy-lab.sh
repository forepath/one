#!/bin/bash
# runc/CRIU pre-copy lab (M6 spike 0a): run as root on a real kernel (NOT under Docker Desktop: its dockerd runs
# under seccomp, every container inherits the filter and CRIU cannot suspend seccomp). Needs runc, criu, python3,
# docker (only to export the alpine:3.24 rootfs). Simulates node A -> node B with the same IP in a new netns.
# runc/CRIU pre-copy lab: node "A" = bundle /lab/a + netns nsA, node "B" = bundle /lab/b + netns nsB (same IP), fresh runc roots.
set -u
R_A="runc --root /run/runc-a"; R_B="runc --root /run/runc-b"
cleanup() { $R_A kill c1 KILL 2>/dev/null; $R_B kill c1 KILL 2>/dev/null; sleep 1; $R_A delete -f c1 2>/dev/null; $R_B delete -f c1 2>/dev/null; pkill -f lab-client; ip netns del nsA 2>/dev/null; ip netns del nsB 2>/dev/null; ip netns del cli 2>/dev/null; ip link del br-lab 2>/dev/null; rm -rf /lab; }
cleanup
mkdir -p /lab/a/rootfs /lab/cp
docker create --name lab-src alpine:3.24 >/dev/null && docker export lab-src | tar -x -C /lab/a/rootfs && docker rm lab-src >/dev/null
cd /lab/a && runc spec && python3 - <<'PY'
import json; p='/lab/a/config.json'; c=json.load(open(p))
c['process']['terminal']=False
c['process']['args']=['sh','-c','x=$(head -c 150000000 /dev/zero | tr "\\0" a); i=0; (nc -lk -p 9000 >> /tmp/recv &) ; while true; do i=$((i+1)); echo $i > /tmp/count; sleep 1; done']
c['root']['readonly']=False
c['linux']['namespaces']=[n if n['type']!='network' else {'type':'network','path':'/var/run/netns/nsA'} for n in c['linux']['namespaces']]
c['mounts']=[m if m['destination']!='/dev/shm' else {**m,'options':m['options'][:-1]+['size=300m']} for m in c['mounts']]
json.dump(c,open(p,'w'),indent=1)
PY
ip link add br-lab type bridge; ip addr add 10.77.0.1/24 dev br-lab; ip link set br-lab up
mkns() { ip netns add $1; ip link add v-$1 type veth peer name eth0 netns $1; ip link set v-$1 master br-lab up; ip -n $1 addr add $2/24 dev eth0; ip -n $1 link set eth0 up; ip -n $1 link set lo up; }
mkns nsA 10.77.0.10; mkns cli 10.77.0.20
$R_A run -d c1 >/dev/null 2>&1 </dev/null; echo "run rc=$?"; sleep 1
# preload 200 MiB of anonymous-ish memory via tmpfs (/dev/shm) so the dumps have some size
sleep 4
ip netns exec cli bash -c 'exec -a lab-client bash -c "exec </dev/null >/dev/null 2>&1; exec 3<>/dev/tcp/10.77.0.10/9000; while true; do date +%s.%N >&3; sleep 0.2; done"' </dev/null >/dev/null 2>&1 &
sleep 2; echo "recv lines before: $(wc -l < /lab/a/rootfs/tmp/recv)"
echo "file-written-before-checkpoint" > /lab/a/rootfs/root/written
OPTS="--tcp-established --manage-cgroups-mode=soft"
for r in 1 2 3; do
  parent=""; [ $r -gt 1 ] && parent="--parent-path ../p$((r-1))"
  s=$(date +%s%N); $R_A checkpoint --pre-dump $OPTS --image-path /lab/cp/p$r $parent c1; rc=$?
  echo "pre-dump $r rc=$rc ms=$(( ($(date +%s%N)-s)/1000000 )) size=$(du -sh /lab/cp/p$r | cut -f1)"
  sleep 1
done
s=$(date +%s%N); $R_A checkpoint $OPTS --image-path /lab/cp/final --parent-path ../p3 c1; rc=$?; e=$(date +%s%N)
echo "final dump rc=$rc ms=$(( (e-s)/1000000 )) size=$(du -sh /lab/cp/final | cut -f1) (cumulative $(du -sch /lab/cp/* | tail -1 | cut -f1))"
grep -hE "Error|Warn" /lab/cp/final/dump.log 2>/dev/null | head -5
# --- "node B": new netns with the same IP, copied rootfs, fresh runc root
ip netns del nsA; mkns nsB 10.77.0.10
mkdir -p /lab/b && cp -a /lab/a/rootfs /lab/b/rootfs && sed 's#/var/run/netns/nsA#/var/run/netns/nsB#; s#/lab/a/#/lab/b/#' /lab/a/config.json > /lab/b/config.json
cd /lab/b; s2=$(date +%s%N); $R_B restore -d $OPTS --image-path /lab/cp/final c1 </dev/null >/dev/null 2>&1; rc=$?; e2=$(date +%s%N)
echo "restore rc=$rc ms=$(( (e2-s2)/1000000 )) freeze(total dump start -> restored)=$(( (e2-s)/1000000 ))ms"
[ $rc -ne 0 ] && grep -hE "Error" /lab/cp/final/restore.log | head -8
sleep 3; $R_B list
n1=$(wc -l < /lab/b/rootfs/tmp/recv); sleep 2; n2=$(wc -l < /lab/b/rootfs/tmp/recv)
echo "B recv lines: $n1 -> $n2 (grows => TCP connection survived); count=$(cat /lab/b/rootfs/tmp/count); written=$(cat /lab/b/rootfs/root/written)"
pgrep -f lab-client >/dev/null && echo "client still connected/alive" || echo "client gone"
pkill -f lab-client
