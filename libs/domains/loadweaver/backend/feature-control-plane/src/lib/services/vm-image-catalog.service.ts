import type { RequestWithUser } from '@forepath/identity/backend';
import { isVmImageManifest } from '@forepath/loadweaver/shared/util-model';
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Not } from 'typeorm';

import { ProjectAccessService } from '../access/project-access.service';
import { NodeEntity } from '../entities/node.entity';
import { REGISTRY_PRIVATE_PORT } from '../object-store/registry-state.utils';
import {
  indexChildren,
  isIndex,
  projectRepositories,
  VM_IMAGE_MANIFEST_ACCEPT,
  vmImageVariant,
  vmRegistryImage,
  type VmRegistryImageDto,
} from '../utils/vm-image-catalog.utils';
import { nodeAddress } from './object-store-controller.service';
import { RegistryTokenService } from './registry-token.service';

const PAGE_SIZE = 500;
const MAX_REPOSITORIES = 100;
const MAX_TAGS = 50;
/** Manifest + config reads per listing (a project with many container images stays cheap). */
const MAX_READS = 400;
const CACHE_MS = 30_000;
const REQUEST_TIMEOUT_MS = 10_000;
const PARALLEL = 8;

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * VM images in a project's registry repositories (3.35): the registry catalog filtered to the project's namespace,
 * each repository's tags, and the manifests (media type / `artifactType` check, config for arch / format / size).
 * Lists what `lw vm-image push` (or any OCI client) pushed, next to the API imports. Read through the members over
 * the overlay with short CP tokens; cached for 30 s per project.
 */
@Injectable()
export class VmImageCatalogService {
  private readonly logger = new Logger(VmImageCatalogService.name);
  private readonly cache = new Map<string, { at: number; images: Promise<VmRegistryImageDto[]> }>();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ProjectAccessService,
    private readonly registryTokens: RegistryTokenService,
  ) {}

  protected fetchImpl: FetchLike = (url, init) => fetch(url, init);

  async list(req: RequestWithUser | undefined, project: string): Promise<VmRegistryImageDto[]> {
    await this.access.assertRead(req, project);

    const cached = this.cache.get(project);

    if (cached && Date.now() - cached.at < CACHE_MS) return await cached.images;

    const images = this.read(project);

    this.cache.set(project, { at: Date.now(), images });
    images.catch(() => this.cache.delete(project));

    return await images;
  }

  private async endpoints(): Promise<string[]> {
    const members = await this.dataSource
      .getRepository(NodeEntity)
      .find({ where: { controlPlane: true, lifecycle: Not('left'), connected: true }, order: { name: 'ASC' } });

    return members
      .map((n) => nodeAddress(n))
      .filter((a): a is string => !!a)
      .map((a) => `${a}:${REGISTRY_PRIVATE_PORT}`);
  }

  private async get(endpoints: string[], path: string, token: string, accept?: string): Promise<Response> {
    let last: unknown = new Error('no registry member reachable');

    for (const endpoint of endpoints) {
      try {
        return await this.fetchImpl(`http://${endpoint}/v2/${path}`, {
          headers: { Authorization: `Bearer ${token}`, ...(accept ? { Accept: accept } : {}) },
          redirect: 'error',
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        last = error;
      }
    }

    throw last;
  }

  private async json(endpoints: string[], path: string, token: string, accept?: string): Promise<unknown> {
    const res = await this.get(endpoints, path, token, accept);

    if (res.status === 404) return null;

    if (!res.ok) throw new Error(`registry ${path.split('?')[0]}: HTTP ${res.status}`);

    return await res.json();
  }

  private async read(project: string): Promise<VmRegistryImageDto[]> {
    const endpoints = await this.endpoints();

    if (endpoints.length === 0) throw new ServiceUnavailableException('the built-in registry is not reachable');

    const catalogToken = await this.registryTokens.issueWithCatalog('control-plane:vm-image-catalog', [], 60);
    const repositories: string[] = [];
    let last = `${project}/`;

    for (;;) {
      const page = (await this.json(
        endpoints,
        `_catalog?n=${PAGE_SIZE}&last=${encodeURIComponent(last)}`,
        catalogToken,
      )) as { repositories?: unknown } | null;
      const { repositories: mine, more } = projectRepositories(project, page ?? {}, PAGE_SIZE);

      repositories.push(...mine);

      if (!more || mine.length === 0 || repositories.length >= MAX_REPOSITORIES) break;

      last = mine[mine.length - 1];
    }

    const repos = repositories.slice(0, MAX_REPOSITORIES);

    if (repos.length === 0) return [];

    const token = await this.registryTokens.issue(
      'control-plane:vm-image-catalog',
      repos.map((name) => ({ name, actions: ['pull'] })),
      300,
    );
    let reads = 0;
    const images: VmRegistryImageDto[] = [];
    const describe = async (repository: string, reference: string) => {
      if (reads++ >= MAX_READS) return null;

      const res = await this.get(endpoints, `${repository}/manifests/${reference}`, token, VM_IMAGE_MANIFEST_ACCEPT);

      if (!res.ok) return null;

      return {
        manifest: (await res.json()) as Record<string, unknown>,
        digest: res.headers.get('docker-content-digest'),
      };
    };
    const variant = async (repository: string, manifest: Record<string, unknown>) => {
      const config = manifest['config'] as { digest?: string } | undefined;

      // Only VM artifacts get their config read (container images are skipped by media type alone).
      if (!isVmImageManifest(manifest)) return null;

      if (!config?.digest || reads++ >= MAX_READS) return null;

      const blob = await this.json(endpoints, `${repository}/blobs/${config.digest}`, token);

      return vmImageVariant(manifest, blob);
    };

    for (const repository of repos) {
      if (reads >= MAX_READS) break;

      const tagList = (await this.json(endpoints, `${repository}/tags/list?n=${MAX_TAGS}`, token).catch(
        () => null,
      )) as {
        tags?: unknown;
      } | null;
      const tags = (Array.isArray(tagList?.tags) ? tagList.tags : [])
        .filter((t): t is string => typeof t === 'string' && !/^sha256-[0-9a-f]{64}(\..*)?$/.test(t))
        .slice(0, MAX_TAGS);

      for (let i = 0; i < tags.length; i += PARALLEL) {
        const found = await Promise.all(
          tags.slice(i, i + PARALLEL).map(async (tag) => {
            try {
              const top = await describe(repository, tag);

              if (!top) return null;

              const variants = [];

              if (isIndex(top.manifest)) {
                for (const child of indexChildren(top.manifest)) {
                  const read = await describe(repository, child);
                  const v = read ? await variant(repository, read.manifest) : null;

                  if (v) variants.push(v);
                }
              } else {
                const v = await variant(repository, top.manifest);

                if (v) variants.push(v);
              }

              return variants.length > 0 ? vmRegistryImage(project, repository, tag, top.digest ?? '', variants) : null;
            } catch (error) {
              this.logger.debug(`${repository}:${tag}: ${(error as Error).message}`);

              return null;
            }
          }),
        );

        images.push(...found.filter((f): f is VmRegistryImageDto => !!f));
      }
    }

    return images.sort((a, b) => a.repository.localeCompare(b.repository) || b.tag.localeCompare(a.tag));
  }
}
