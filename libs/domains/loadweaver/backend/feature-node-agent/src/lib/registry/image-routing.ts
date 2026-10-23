import type { RegistryClient, WorkloadSpec } from '@forepath/loadweaver/shared/util-agent-protocol';
import { parseImageReference } from '@forepath/loadweaver/shared/util-compose';

/**
 * The image Docker pulls (3.22): images of mirrored registries and of the private registry go through the
 * node's loopback router (`127.0.0.1:<port>/<host>/<repository>@<digest>`); everything else is pulled directly.
 */
export function routedImage(image: string, client: RegistryClient | undefined): string {
  const ref = client ? parseImageReference(image) : null;

  if (!client || !ref) return image;

  if (ref.host !== client.privateHost && !client.mirrors.some((m) => m.host === ref.host)) return image;

  return `127.0.0.1:${client.routerPort}/${ref.host}/${ref.repository}${ref.digest ? `@${ref.digest}` : `:${ref.tag ?? 'latest'}`}`;
}

/**
 * Private repositories the node may pull: only those its own workloads use (a generic microVM's guest image and a
 * full VM's disk image too: their blobs are fetched through the router, 3.35).
 */
export function privateRepositories(
  workloads: readonly (Pick<WorkloadSpec, 'image'> & Partial<Pick<WorkloadSpec, 'microvm' | 'vm'>>)[],
  client: RegistryClient | undefined,
): Set<string> {
  const repositories = new Set<string>();

  for (const workload of client ? workloads : []) {
    for (const image of [
      workload.image,
      ...(workload.microvm?.guestImage ? [workload.microvm.guestImage] : []),
      ...(workload.vm ? [workload.vm.image.ref] : []),
    ]) {
      const ref = parseImageReference(image);

      if (ref && ref.host === client?.privateHost) repositories.add(ref.repository);
    }
  }

  return repositories;
}
