import {
  matchesSelector,
  type ImagePolicySpec,
  VULNERABILITY_SEVERITIES,
} from '@forepath/loadweaver/shared/util-model';
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

import type { ImageScan } from '@forepath/loadweaver/shared/util-agent-protocol';
import { DeploymentStateEntity } from '../entities/deployment-state.entity';
import { WorkloadPlacementEntity } from '../entities/workload-placement.entity';

import { ImageScanEntity } from '../entities/image-scan.entity';
import { verifyCosignSignature, type RepositoryReader } from './image-signature';

export interface NamedImagePolicy {
  /** Owning project; undefined for cluster-wide policies. */
  project?: string;
  name: string;
  spec: ImagePolicySpec;
}

export interface ImageCheckTarget {
  project: string;
  deployment: string;
  service: string;
  labels: Record<string, string>;
  /** Pinned reference (`name@sha256:…`). */
  image: string;
}

export interface ImageIssue {
  level: 'error' | 'warning' | 'info';
  project: string;
  deployment: string;
  path: string;
  message: string;
}

/** The policies covering a service: its project's and the cluster-wide ones whose selector matches it. */
export function applicableImagePolicies(
  policies: readonly NamedImagePolicy[],
  target: Pick<ImageCheckTarget, 'project' | 'service' | 'labels'>,
): NamedImagePolicy[] {
  return policies.filter(
    (p) =>
      (!p.project || p.project === target.project) &&
      (!p.spec.selector || matchesSelector(p.spec.selector, { name: target.service, labels: target.labels })),
  );
}

/** Blocked findings of a scan for a policy: per blocked severity, all or only fixable ones. */
export function blockedFindings(
  scan: Pick<ImageScanEntity, 'summary'>,
  rule: NonNullable<ImagePolicySpec['vulnerabilities']>,
): number {
  return rule.block.reduce((sum, severity) => {
    const count = scan.summary.counts[severity];

    return sum + (count ? (rule.ignoreUnfixed ? count.fixable : count.total) : 0);
  }, 0);
}

/**
 * What the node checks after pulling (3.22): the vulnerability limits of every policy covering the service, one rule
 * per policy, so each is judged with its own mode and settings (a monitor policy never blocks, as in plans).
 */
export function runtimeImagePolicy(
  policies: readonly NamedImagePolicy[],
  target: Pick<ImageCheckTarget, 'project' | 'service' | 'labels'>,
):
  | { mode: 'enforce' | 'monitor'; block: (typeof VULNERABILITY_SEVERITIES)[number][]; ignoreUnfixed: boolean }[]
  | undefined {
  const rules = applicableImagePolicies(policies, target).flatMap((p) =>
    p.spec.vulnerabilities
      ? [
          {
            mode: p.spec.mode,
            block: VULNERABILITY_SEVERITIES.filter((s) => p.spec.vulnerabilities?.block.includes(s)),
            ignoreUnfixed: p.spec.vulnerabilities.ignoreUnfixed,
          },
        ]
      : [],
  );

  return rules.length > 0 ? rules : undefined;
}

/**
 * Image policies at plan time (3.22): signatures are verified against the pinned digest, vulnerabilities judged from
 * the latest scan of that digest. `enforce` failures reject the plan, `monitor` ones are warnings; images not
 * scanned yet are checked by the nodes when they pull them.
 */
@Injectable()
export class ImagePolicyService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * A node's scan report (3.22), kept as the digest's latest scan — only for images of workloads that node runs, so
   * no node can write results for images it doesn't have.
   */
  async record(nodeName: string, scan: ImageScan): Promise<boolean> {
    const placements = await this.dataSource
      .getRepository(WorkloadPlacementEntity)
      .find({ where: [{ node: nodeName }, { targetNode: nodeName }] });
    const deployments = new Set(placements.map((p) => `${p.project}/${p.deployment}`));
    const states = await this.dataSource.getRepository(DeploymentStateEntity).find();
    const runs = states.some(
      (s) => deployments.has(s.id) && Object.values(s.images).some((image) => image.endsWith(`@${scan.digest}`)),
    );

    if (!runs) return false;

    await this.dataSource.getRepository(ImageScanEntity).save({
      digest: scan.digest,
      image: scan.image.slice(0, 512),
      scannedAt: new Date(),
      node: nodeName,
      scanner: scan.scanner,
      summary: { counts: scan.counts },
      findings: scan.findings,
    });

    return true;
  }

  async scans(): Promise<ImageScanEntity[]> {
    return await this.dataSource.getRepository(ImageScanEntity).find({ order: { scannedAt: 'DESC' }, take: 500 });
  }

  private readonly signatures = new Map<string, { verified: boolean; reason?: string; at: number }>();

  async evaluate(
    manager: EntityManager,
    targets: readonly ImageCheckTarget[],
    policies: readonly NamedImagePolicy[],
    reader: (image: string) => RepositoryReader,
    now = Date.now(),
  ): Promise<ImageIssue[]> {
    const issues: ImageIssue[] = [];
    const scans = manager.getRepository(ImageScanEntity);

    for (const target of targets) {
      const digest = /@(sha256:[0-9a-f]{64})$/.exec(target.image)?.[1];
      const path = `services.${target.service}.image`;
      const issue = (policy: NamedImagePolicy, message: string) =>
        issues.push({
          level: policy.spec.mode === 'enforce' ? 'error' : 'warning',
          project: target.project,
          deployment: target.deployment,
          path,
          message: `${message} (ImagePolicy ${policy.project ? `${policy.project}/` : ''}${policy.name}${policy.spec.mode === 'monitor' ? ', monitor' : ''})`,
        });

      if (!digest) continue;

      for (const policy of applicableImagePolicies(policies, target)) {
        if (policy.spec.requireSignature) {
          const key = `${digest}|${policy.spec.requireSignature.keys.join('|')}`;
          let result = this.signatures.get(key);

          // Verified signatures are kept for an hour; failures are checked again on the next plan.
          if (!result || !result.verified || now - result.at > 3_600_000) {
            const checked = await verifyCosignSignature(
              reader(target.image),
              digest,
              policy.spec.requireSignature.keys,
            ).catch((error: unknown) => ({
              verified: false as const,
              reason: error instanceof Error ? error.message : 'unreadable',
            }));

            result =
              'reason' in checked ? { verified: false, reason: checked.reason, at: now } : { verified: true, at: now };
            this.signatures.set(key, result);
          }

          if (!result.verified) issue(policy, `${target.image} is not signed by a policy key: ${result.reason}`);
        }

        if (policy.spec.vulnerabilities) {
          const scan = await scans.findOne({ where: { digest } });

          if (!scan) {
            issues.push({
              level: 'info',
              project: target.project,
              deployment: target.deployment,
              path,
              message: `${target.image} has not been scanned yet; nodes scan it when they pull it${policy.spec.mode === 'enforce' ? ' and refuse to run it if it violates the policy' : ''}`,
            });
            continue;
          }

          const blocked = blockedFindings(scan, policy.spec.vulnerabilities);

          if (blocked > 0) {
            const counts = VULNERABILITY_SEVERITIES.filter((s) => policy.spec.vulnerabilities?.block.includes(s))
              .map(
                (s) =>
                  `${scan.summary.counts[s]?.[policy.spec.vulnerabilities?.ignoreUnfixed ? 'fixable' : 'total'] ?? 0} ${s.toLowerCase()}`,
              )
              .join(', ');
            const examples = scan.findings
              .filter((f) => policy.spec.vulnerabilities?.block.includes(f.severity as never))
              .slice(0, 3)
              .map((f) => `${f.id} in ${f.package}`)
              .join(', ');

            issue(policy, `${target.image} has ${counts} vulnerabilities${examples ? ` (e.g. ${examples})` : ''}`);
          }
        }
      }
    }

    return issues;
  }
}
