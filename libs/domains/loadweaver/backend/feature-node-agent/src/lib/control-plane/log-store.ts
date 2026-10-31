import { createHash } from 'node:crypto';

import type { ControlPlaneRole } from '@forepath/loadweaver/shared/util-agent-protocol';
import { COMPONENT_IMAGES } from '@forepath/loadweaver/shared/util-release';

import type { ManagedContainerSpec } from '../host/managed-containers';
import { componentImage } from '../updates/release-images';
import { openSearchBackupSettings } from './platform-backups';

/** This build's pin (section 6, `COMPONENT_IMAGES`); the node runs its release's image instead (3.26). */
export const DEFAULT_OPENSEARCH_IMAGE = COMPONENT_IMAGES['opensearch'];
export const LOG_STORE_CONTAINER = 'lw-opensearch';
export const LOG_STORE_COMPONENT = 'log-store';
/** The image runs OpenSearch as this user; its data directory has to belong to it. */
export const OPENSEARCH_UID = 1000;
/** OpenSearch's bootstrap checks for a cluster bound to a non-loopback address. */
export const MIN_MAX_MAP_COUNT = 262_144;

export function openSearchImage(env: NodeJS.ProcessEnv = process.env): string {
  return componentImage('opensearch', env);
}

function host(address: string): string {
  return address.includes(':') ? `[${address}]` : address;
}

const INITIAL_MANAGERS = 'cluster.initial_cluster_manager_nodes';
const SEED_HOSTS = 'discovery.seed_hosts';

/**
 * OpenSearch on a control-plane member (3.14): bound to the overlay (only the other members reach it, through the
 * built-in quorum policy) and loopback; one member runs single-node, more discover each other over the overlay.
 * The security plugin is off: the store is never reachable from outside the members, and the API on the same
 * member is its only client.
 */
export function logStoreSpec(
  nodeName: string,
  address: string,
  role: ControlPlaneRole,
  dataDir: string,
  image: string,
): ManagedContainerSpec {
  const store = role.logStore;

  if (!store) throw new Error('no log store in the control-plane role');

  const members = role.members.filter((m) => !m.witness);
  const others = members.filter((m) => m.name !== nodeName && m.address);
  // First formation follows the etcd bootstrap (3.43). OpenSearch needs the initial cluster managers identical on every
  // node that may bootstrap and absent on the others: only the etcd founder (the bootstrapper, or the sole member
  // holding etcd data) names itself; every other member only joins through the seed hosts and never bootstraps. Naming
  // the etcd peers there (which include members that just connected) let two joiners form a second cluster while the
  // founder's log store restarted (live 3.43). Without the etcd block (older control planes): all members.
  const names = members.map((m) => m.name);
  const peers = role.etcd?.peers ?? [];
  const founder = !!role.etcd?.bootstrap || (peers.length === 1 && peers[0] === nodeName);
  const initial = !role.etcd ? names : founder ? [nodeName] : [];
  const env: Record<string, string> = {
    'cluster.name': store.clusterName,
    'node.name': nodeName,
    'network.bind_host': `${address},127.0.0.1`,
    'network.publish_host': address,
    'http.port': String(store.httpPort),
    'transport.port': String(store.transportPort),
    'bootstrap.memory_lock': 'false',
    'action.auto_create_index': 'true',
    OPENSEARCH_JAVA_OPTS: `-Xms${store.heapMb}m -Xmx${store.heapMb}m`,
    DISABLE_SECURITY_PLUGIN: 'true',
    DISABLE_INSTALL_DEMO_CONFIG: 'true',
    ...(members.length <= 1
      ? { 'discovery.type': 'single-node' }
      : {
          [SEED_HOSTS]: others.map((m) => `${host(m.address)}:${store.transportPort}`).join(','),
          ...(initial.length > 0 ? { [INITIAL_MANAGERS]: [...initial].sort().join(',') } : {}),
        }),
  };

  // Snapshot repository client through the member's backup gateway (3.20).
  const backups = openSearchBackupSettings(role);

  Object.assign(env, backups?.env ?? {});

  // Not part of the hash: the initial cluster managers only count for a brand-new cluster, and the container is created
  // after the etcd step settled (bootstrapper: itself; joiners: the members holding data). In the hash, every change of
  // the etcd peers (a member reconnecting, joining or leaving) restarted the log store on every member (live 3.43).
  // Nor the seed hosts (the other members' addresses): they only matter while a node looks for its cluster. A running
  // node knows the cluster's nodes from the cluster state, and a restarted one also tries every cluster-manager-eligible
  // node of its last-known cluster state, so a member joining or leaving needn't restart every log store (live 3.43).
  // Single-node ↔ multi-node (`discovery.type`) still re-creates.
  const hashed = Object.fromEntries(
    Object.entries(env).filter(([key]) => key !== INITIAL_MANAGERS && key !== SEED_HOSTS),
  );

  return {
    name: LOG_STORE_CONTAINER,
    image,
    ...(backups ? { cmd: backups.cmd } : {}),
    env,
    binds: [`${dataDir}:/usr/share/opensearch/data`],
    // Heap plus off-heap (Lucene, direct buffers).
    memoryBytes: store.heapMb * 2 * 1024 ** 2,
    hash: createHash('sha256')
      .update(JSON.stringify(backups ? { image, env: hashed, cmd: backups.cmd } : { image, env: hashed }))
      .digest('hex')
      .slice(0, 16),
    component: LOG_STORE_COMPONENT,
  };
}

/** The API on the member talks to its local OpenSearch. */
export function logStoreApiEnvironment(address: string, role: ControlPlaneRole): Record<string, string> {
  return role.logStore
    ? {
        OPENSEARCH_ENABLED: 'true',
        OPENSEARCH_NODE: `http://${host(address)}:${role.logStore.httpPort}`,
        OPENSEARCH_INDEX_PREFIX: 'loadweaver',
      }
    : { OPENSEARCH_ENABLED: 'false' };
}
