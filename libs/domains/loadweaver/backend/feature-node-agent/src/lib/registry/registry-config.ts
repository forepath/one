import { createHash } from 'node:crypto';

import type { RegistryRole } from '@forepath/loadweaver/shared/util-agent-protocol';
import { COMPONENT_IMAGES } from '@forepath/loadweaver/shared/util-release';
import { stringify } from 'yaml';

import type { ManagedContainerSpec } from '../host/managed-containers';
import { componentImage } from '../updates/release-images';

/** This build's pin (section 6, `COMPONENT_IMAGES`); the node runs its release's image instead (3.26). */
export const DEFAULT_REGISTRY_IMAGE = COMPONENT_IMAGES['registry'];
export const REGISTRY_COMPONENT = 'registry';
export const PRIVATE_REGISTRY_CONTAINER = 'lw-registry';

export function registryImage(env: NodeJS.ProcessEnv = process.env): string {
  return componentImage('registry', env);
}

export function mirrorContainerName(host: string): string {
  return `lw-registry-mirror-${createHash('sha256').update(host).digest('hex').slice(0, 10)}`;
}

function socket(address: string, port: number): string {
  return `${address.includes(':') ? `[${address}]` : address}:${port}`;
}

export interface RegistryInstance {
  name: string;
  config: string;
}

/**
 * Distribution configurations (3.22): the private instance (token auth, read-only during an object-store
 * migration) and one pull-through cache per mirror. All store in the active Garage generation under their own
 * prefix and listen on the overlay address only.
 */
export function renderRegistryInstances(role: RegistryRole, overlayAddress: string): RegistryInstance[] {
  if (!role.accessKeyId || !role.secretAccessKey || !role.httpSecret)
    throw new Error('registry role arrived without its secrets');

  const storage = (rootdirectory: string, readOnly: boolean) => ({
    s3: {
      region: 'garage',
      regionendpoint: `http://${socket(role.s3.address, role.s3.port)}`,
      bucket: role.bucket,
      rootdirectory,
      forcepathstyle: true,
      accesskey: role.accessKeyId,
      secretkey: role.secretAccessKey,
    },
    // Blobs are served through the registry; nodes never talk to Garage directly.
    redirect: { disable: true },
    cache: { blobdescriptor: 'inmemory' },
    maintenance: {
      uploadpurging: { enabled: true, age: '168h', interval: '24h', dryrun: false },
      readonly: { enabled: readOnly },
    },
  });
  // Relative Location headers: uploads also work through the control-plane API's `/v2` proxy.
  const http = (port: number) => ({
    addr: socket(overlayAddress, port),
    secret: role.httpSecret,
    relativeurls: true,
    headers: { 'X-Content-Type-Options': ['nosniff'] },
  });
  const base = { version: 0.1, log: { level: 'warn', accesslog: { disabled: true } } };

  return [
    {
      name: PRIVATE_REGISTRY_CONTAINER,
      config: stringify({
        ...base,
        storage: { ...storage('/private', role.readOnly), delete: { enabled: true } },
        http: http(role.privatePort),
        auth: {
          token: {
            realm: role.token.realm,
            service: role.token.service,
            issuer: role.token.issuer,
            rootcertbundle: '/etc/distribution/ca.pem',
            autoredirect: false,
          },
        },
      }),
    },
    ...role.mirrors.map((mirror) => ({
      name: mirrorContainerName(mirror.host),
      // Cache misses during a migration are simply fetched again later, so mirrors stay writable.
      config: stringify({
        ...base,
        storage: storage(`/mirror/${mirror.host}`, false),
        http: http(mirror.port),
        proxy: { remoteurl: mirror.remoteUrl, ttl: '168h' },
      }),
    })),
  ];
}

export function registrySpec(
  instance: RegistryInstance,
  dir: string,
  caPem: string,
  image: string,
): ManagedContainerSpec {
  return {
    name: instance.name,
    image,
    env: {},
    binds: [`${dir}/${instance.name}.yml:/etc/distribution/config.yml:ro`, `${dir}/ca.pem:/etc/distribution/ca.pem:ro`],
    memoryBytes: 256 * 1024 ** 2,
    hash: createHash('sha256')
      .update(JSON.stringify({ image, config: instance.config, caPem }))
      .digest('hex')
      .slice(0, 16),
    component: REGISTRY_COMPONENT,
  };
}
