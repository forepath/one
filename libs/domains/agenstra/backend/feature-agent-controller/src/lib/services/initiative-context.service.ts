import {
  INITIATIVE_ARTIFACT_TYPE_LABELS,
  INITIATIVE_CONTRACT_ARTIFACT_TYPES,
  INITIATIVE_LIMITS,
  isFindingSeverity,
  parseInitiativeProposal,
} from '@forepath/agenstra/shared/util-initiative-method';
import type { AgentContentChangeResult } from '@forepath/agenstra/shared/util-opencode-config';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { InitiativeArtifactVersionEntity } from '../entities/initiative-artifact-version.entity';
import { InitiativeArtifactEntity } from '../entities/initiative-artifact.entity';
import { InitiativeDecisionEntity } from '../entities/initiative-decision.entity';
import { InitiativeFindingEntity } from '../entities/initiative-finding.entity';
import { InitiativeWorkItemEntity } from '../entities/initiative-work-item.entity';
import { InitiativeDecisionStatus } from '../entities/initiative.enums';
import { InitiativeEntity } from '../entities/initiative.entity';
import { TicketEntity } from '../entities/ticket.entity';
import type { AgentContentWriter } from '../utils/agent-content-writer.utils';

import type { InitiativeSessionContext } from './initiative-automation-hooks';
import { InitiativeLearnService } from './initiative-learn.service';
import { InitiativeWorkItemsService, type InitiativeTree } from './initiative-work-items.service';
import { InitiativesService } from './initiatives.service';

/** Context kinds served by Initiatives (`initiative:<sha>` overview, `artifact:<sha>` document). */
export type InitiativeContextKind = 'initiative' | 'artifact';

export interface InitiativeContextMetadata {
  kind: InitiativeContextKind;
  sha: string;
  title: string;
  status?: string;
  parentSha?: string | null;
  size?: number;
}

export interface InitiativeContextContent extends InitiativeContextMetadata {
  revision: string;
  content: string;
}

/** Overview and document bodies served to agents stay bounded. */
const OVERVIEW_MAX_LENGTH = 120_000;
const REQUIREMENTS_EXCERPT_LENGTH = 1_500;
const SESSION_CONTEXT_MAX_DOCUMENTS = 12;

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}… (${text.length - max} more characters)`;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/** Change of an agent on an initiative (validated by the manager; authoritative checks here). */
export interface InitiativeAgentChange {
  operation: 'initiative.propose' | 'initiative.finding';
  sha: string;
  title?: string;
  rationale?: string;
  artifacts?: unknown[];
  workItems?: unknown[];
  decisions?: unknown[];
  body?: string;
  severity?: string;
  itemKey?: string;
  evidence?: string[];
}

/**
 * What agents read and write of initiatives: metadata / content for the context MCP (workspace bound), the
 * pre-granted context of step runs, ticket automation and story plans, and proposals / findings agents submit.
 */
@Injectable()
export class InitiativeContextService {
  constructor(
    @InjectRepository(InitiativeEntity)
    private readonly initiativeRepo: Repository<InitiativeEntity>,
    @InjectRepository(InitiativeArtifactEntity)
    private readonly artifactRepo: Repository<InitiativeArtifactEntity>,
    @InjectRepository(InitiativeArtifactVersionEntity)
    private readonly versionRepo: Repository<InitiativeArtifactVersionEntity>,
    @InjectRepository(InitiativeWorkItemEntity)
    private readonly itemRepo: Repository<InitiativeWorkItemEntity>,
    @InjectRepository(InitiativeDecisionEntity)
    private readonly decisionRepo: Repository<InitiativeDecisionEntity>,
    @InjectRepository(InitiativeFindingEntity)
    private readonly findingRepo: Repository<InitiativeFindingEntity>,
    @InjectRepository(TicketEntity)
    private readonly ticketRepo: Repository<TicketEntity>,
    private readonly initiatives: InitiativesService,
    private readonly workItems: InitiativeWorkItemsService,
    private readonly learn: InitiativeLearnService,
  ) {}

  // --- context MCP reads -------------------------------------------------------------------------------------------

  async search(
    clientId: string,
    term: string,
    kinds: InitiativeContextKind[],
    limit: number,
  ): Promise<InitiativeContextMetadata[]> {
    const results: InitiativeContextMetadata[] = [];
    const like = `%${escapeLike(term)}%`;
    const prefix = `${escapeLike(term.toLowerCase())}%`;

    if (kinds.includes('initiative')) {
      const qb = this.initiativeRepo
        .createQueryBuilder('i')
        .where('i.client_id = :clientId', { clientId })
        .andWhere('i.long_sha IS NOT NULL');

      if (term) {
        qb.andWhere('(i.title ILIKE :like OR i.long_sha LIKE :prefix)', { like, prefix });
      }

      results.push(
        ...(await qb.orderBy('i.updated_at', 'DESC').take(limit).getMany()).map((row) => this.describeInitiative(row)),
      );
    }

    if (kinds.includes('artifact')) {
      const qb = this.artifactRepo
        .createQueryBuilder('a')
        .where('a.client_id = :clientId', { clientId })
        .andWhere('a.long_sha IS NOT NULL');

      if (term) {
        qb.andWhere('(a.title ILIKE :like OR a.long_sha LIKE :prefix)', { like, prefix });
      }

      results.push(
        ...(await this.describeArtifacts(clientId, await qb.orderBy('a.updated_at', 'DESC').take(limit).getMany())),
      );
    }

    return results.slice(0, limit);
  }

  async describe(
    clientId: string,
    refs: Array<{ kind: InitiativeContextKind; sha: string }>,
  ): Promise<InitiativeContextMetadata[]> {
    const results: InitiativeContextMetadata[] = [];

    for (const ref of refs) {
      if (ref.kind === 'initiative') {
        const row = await this.findInitiative(clientId, ref.sha);

        if (row) {
          results.push(this.describeInitiative(row));
        }
      } else {
        const row = await this.findArtifact(clientId, ref.sha);

        if (row) {
          results.push(...(await this.describeArtifacts(clientId, [row])));
        }
      }
    }

    return results;
  }

  async content(
    clientId: string,
    refs: Array<{ kind: InitiativeContextKind; sha: string }>,
  ): Promise<InitiativeContextContent[]> {
    const results: InitiativeContextContent[] = [];

    for (const ref of refs) {
      if (ref.kind === 'initiative') {
        const row = await this.findInitiative(clientId, ref.sha);

        if (row) {
          results.push({
            ...this.describeInitiative(row),
            revision: String(row.version),
            content: await this.renderOverview(row),
          });
        }
      } else {
        const row = await this.findArtifact(clientId, ref.sha);

        if (row) {
          const [meta] = await this.describeArtifacts(clientId, [row]);

          results.push({ ...meta, revision: String(row.version), content: await this.renderArtifact(row, 'current') });
        }
      }
    }

    return results;
  }

  /** A short SHA only resolves when exactly one element has it (grants are bound to exact elements). */
  private async findInitiative(clientId: string, sha: string): Promise<InitiativeEntity | null> {
    if (sha.length >= 40) {
      return this.initiativeRepo.findOne({ where: { clientId, longSha: sha.slice(0, 40) } });
    }

    const matches = await this.initiativeRepo
      .createQueryBuilder('i')
      .where('i.client_id = :clientId', { clientId })
      .andWhere('i.long_sha LIKE :prefix', { prefix: `${sha}%` })
      .take(2)
      .getMany();

    return matches.length === 1 ? matches[0] : null;
  }

  private async findArtifact(clientId: string, sha: string): Promise<InitiativeArtifactEntity | null> {
    if (sha.length >= 40) {
      return this.artifactRepo.findOne({ where: { clientId, longSha: sha.slice(0, 40) } });
    }

    const matches = await this.artifactRepo
      .createQueryBuilder('a')
      .where('a.client_id = :clientId', { clientId })
      .andWhere('a.long_sha LIKE :prefix', { prefix: `${sha}%` })
      .take(2)
      .getMany();

    return matches.length === 1 ? matches[0] : null;
  }

  private describeInitiative(row: InitiativeEntity): InitiativeContextMetadata {
    return {
      kind: 'initiative',
      sha: row.longSha as string,
      title: row.title,
      status: `${row.state}, ${row.phase}, iteration ${row.iteration}`,
      size: row.intent?.length ?? 0,
    };
  }

  private async describeArtifacts(
    clientId: string,
    rows: InitiativeArtifactEntity[],
  ): Promise<InitiativeContextMetadata[]> {
    const initiativeIds = [...new Set(rows.map((row) => row.initiativeId))];
    const parents = initiativeIds.length
      ? await this.initiativeRepo.find({ where: { clientId, id: In(initiativeIds) }, select: ['id', 'longSha'] })
      : [];
    const parentSha = new Map(parents.map((row) => [row.id, row.longSha ?? null]));

    return rows
      .filter((row) => !!row.longSha)
      .map((row) => ({
        kind: 'artifact' as const,
        sha: row.longSha as string,
        title: `${INITIATIVE_ARTIFACT_TYPE_LABELS[row.type]}: ${row.title}`,
        status:
          row.acceptedVersion === row.currentVersion
            ? `accepted v${row.currentVersion}`
            : `draft v${row.currentVersion}${row.acceptedVersion ? ` (accepted: v${row.acceptedVersion})` : ''}`,
        parentSha: parentSha.get(row.initiativeId) ?? null,
        size: row.content?.length ?? 0,
      }));
  }

  // --- rendering ---------------------------------------------------------------------------------------------------

  /** Overview of an initiative as agents read it (`initiative:<sha>`): intent, documents, work items, decisions. */
  async renderOverview(initiative: InitiativeEntity, tree?: InitiativeTree): Promise<string> {
    const loaded = tree ?? (await this.workItems.loadTree(initiative));
    const artifacts = await this.artifactRepo.find({
      where: { initiativeId: initiative.id },
      order: { createdAt: 'ASC' },
    });
    const decisions = await this.decisionRepo.find({
      where: { initiativeId: initiative.id, status: InitiativeDecisionStatus.ACCEPTED },
      order: { createdAt: 'ASC' },
      take: 100,
    });
    const openFindings = await this.findingRepo.count({ where: { initiativeId: initiative.id, status: 'open' } });
    const ticketShas = await this.ticketShasOf(loaded);
    const dto = new Map(loaded.dtos.map((item) => [item.id, item]));
    const lines: string[] = [
      `# Initiative: ${initiative.title}`,
      '',
      `- Ref: initiative:${initiative.longSha} · path ${initiative.path} · phase ${initiative.phase} · state ${initiative.state} · iteration ${initiative.iteration}`,
      `- Prerequisites count as satisfied when ${initiative.prerequisiteSatisfiedAt}.`,
      '',
      '## Intent',
      '',
      initiative.intent?.trim() || '_(not written yet)_',
      '',
      '## Documents',
      '',
    ];

    if (artifacts.length === 0) {
      lines.push('_(none yet)_');
    }

    for (const artifact of artifacts) {
      const accepted = artifact.acceptedVersion === artifact.currentVersion;

      lines.push(
        `- artifact:${artifact.longSha} ${INITIATIVE_ARTIFACT_TYPE_LABELS[artifact.type]}: ${artifact.title} ` +
          `(${accepted ? 'accepted' : 'draft'} v${artifact.currentVersion}${artifact.workItemId ? `, epic ${loaded.items.find((i) => i.id === artifact.workItemId)?.key ?? ''}` : ''})`,
      );
    }

    lines.push('', '## Work items (build order)', '');

    const epics = loaded.items.filter((item) => item.kind === 'epic');

    if (epics.length === 0) {
      lines.push('_(not sliced yet)_');
    }

    const keyOf = new Map(loaded.items.map((item) => [item.id, item.key]));
    const describeItem = (item: InitiativeWorkItemEntity, indent: string) => {
      const view = dto.get(item.id);
      const after = (view?.prerequisiteIds ?? []).map((id) => keyOf.get(id)).filter(Boolean);
      const ticket = item.ticketId && ticketShas.get(item.ticketId) ? ` · ticket:${ticketShas.get(item.ticketId)}` : '';

      lines.push(
        `${indent}- **${item.key}** [${item.kind}] ${item.title} — ${view?.status ?? item.status}` +
          `${view && !view.ready ? ` (blocked by ${view.blockedBy.join(', ')})` : ''}` +
          `${after.length ? ` · after ${after.join(', ')}` : ''}${ticket}` +
          `${item.kind === 'epic' && !item.refined ? ' · not refined' : ''}` +
          `${item.retrospectiveVerdict ? ` · retrospective: ${item.retrospectiveVerdict}` : ''}`,
      );

      if (item.requirements?.trim()) {
        lines.push(
          `${indent}  Requirements: ${clip(item.requirements.trim().replace(/\n+/g, ' '), REQUIREMENTS_EXCERPT_LENGTH)}`,
        );
      }

      if (item.verify?.trim()) {
        lines.push(`${indent}  Verify: ${clip(item.verify.trim().replace(/\n+/g, ' '), 500)}`);
      }

      if (item.doneWhen?.trim()) {
        lines.push(`${indent}  Done when: ${clip(item.doneWhen.trim().replace(/\n+/g, ' '), 500)}`);
      }

      for (const unknown of loaded.unknowns.filter((u) => u.workItemId === item.id)) {
        lines.push(
          `${indent}  ${unknown.resolvedAt ? 'Settled' : 'Open question'}: ${unknown.question}` +
            `${unknown.resolvedAt ? ` → ${unknown.answer ?? ''}` : ` (${unknown.resolution})`}`,
        );
      }
    };

    for (const epic of epics) {
      describeItem(epic, '');

      for (const child of loaded.items.filter((item) => item.parentId === epic.id)) {
        describeItem(child, '  ');
      }
    }

    const initiativeUnknowns = loaded.unknowns.filter((unknown) => !unknown.workItemId && !unknown.resolvedAt);

    if (initiativeUnknowns.length > 0) {
      lines.push('', '## Open questions', '', ...initiativeUnknowns.map((u) => `- ${u.question} (${u.resolution})`));
    }

    if (decisions.length > 0) {
      lines.push(
        '',
        '## Decisions',
        '',
        ...decisions.map(
          (decision) =>
            `- ${decision.createdAt.toISOString().slice(0, 10)} (iteration ${decision.iteration}) Decision: ${decision.title}` +
            `${decision.body ? ` — ${clip(decision.body.replace(/\n+/g, ' '), 600)}` : ''}`,
        ),
      );
    }

    lines.push('', `Open findings: ${openFindings}.`);

    return clip(lines.join('\n'), OVERVIEW_MAX_LENGTH);
  }

  /** Document body for agents: the accepted version (contract) or the current draft. */
  async renderArtifact(artifact: InitiativeArtifactEntity, which: 'current' | 'accepted'): Promise<string> {
    let content = artifact.content ?? '';
    let label = artifact.acceptedVersion === artifact.currentVersion ? 'accepted' : 'draft, not accepted yet';
    let version = artifact.currentVersion;

    if (which === 'accepted' && artifact.acceptedVersion && artifact.acceptedVersion !== artifact.currentVersion) {
      const row = await this.versionRepo.findOne({
        where: { artifactId: artifact.id, version: artifact.acceptedVersion },
      });

      if (row) {
        content = row.content;
        label = 'accepted';
        version = row.version;
      }
    }

    return [
      `# ${INITIATIVE_ARTIFACT_TYPE_LABELS[artifact.type]}: ${artifact.title} (v${version}, ${label})`,
      '',
      content,
    ].join('\n');
  }

  private async ticketShasOf(tree: InitiativeTree): Promise<Map<string, string>> {
    const ids = tree.items.map((item) => item.ticketId).filter((id): id is string => !!id);

    if (ids.length === 0) {
      return new Map();
    }

    const tickets = await this.ticketRepo.find({
      where: { id: In(ids), clientId: tree.initiative.clientId },
      select: ['id', 'longSha'],
    });

    return new Map(tickets.filter((t) => t.longSha).map((t) => [t.id, t.longSha as string]));
  }

  /**
   * Pre-granted context of a session: the overview plus the shared contracts (accepted versions) and the given
   * documents (current versions). Bounded; refs are index-aligned with the contents.
   */
  async buildSessionContext(
    initiative: InitiativeEntity,
    options: { artifactIds?: string[]; epicId?: string | null; includeContracts?: boolean } = {},
  ): Promise<InitiativeSessionContext> {
    const contexts: string[] = [await this.renderOverview(initiative)];
    const refs: InitiativeSessionContext['initiativeContextRefs'] = [
      { kind: 'initiative', sha: initiative.longSha as string, title: initiative.title },
    ];
    const artifacts = await this.artifactRepo.find({
      where: { initiativeId: initiative.id },
      order: { createdAt: 'ASC' },
    });
    const chosen: Array<{ artifact: InitiativeArtifactEntity; which: 'current' | 'accepted' }> = [];

    for (const id of options.artifactIds ?? []) {
      const artifact = artifacts.find((row) => row.id === id);

      if (artifact) {
        chosen.push({ artifact, which: 'current' });
      }
    }

    if (options.includeContracts !== false) {
      for (const artifact of artifacts) {
        if (
          !artifact.workItemId &&
          artifact.acceptedVersion &&
          INITIATIVE_CONTRACT_ARTIFACT_TYPES.includes(artifact.type) &&
          !chosen.some((entry) => entry.artifact.id === artifact.id)
        ) {
          chosen.push({ artifact, which: 'accepted' });
        }
      }
    }

    if (options.epicId) {
      for (const artifact of artifacts.filter((row) => row.workItemId === options.epicId)) {
        if (!chosen.some((entry) => entry.artifact.id === artifact.id)) {
          chosen.push({ artifact, which: 'current' });
        }
      }
    }

    for (const { artifact, which } of chosen.slice(0, SESSION_CONTEXT_MAX_DOCUMENTS)) {
      if (!artifact.longSha) {
        continue;
      }

      contexts.push(await this.renderArtifact(artifact, which));
      refs.push({
        kind: 'artifact',
        sha: artifact.longSha,
        title: `${INITIATIVE_ARTIFACT_TYPE_LABELS[artifact.type]}: ${artifact.title}`,
      });
    }

    return { initiativeContexts: contexts, initiativeContextRefs: refs };
  }

  /** Context of a transferred story's ticket (automation runs, story plans), or null when the ticket is not linked. */
  async contextForTicket(ticketId: string, clientId: string): Promise<InitiativeSessionContext | null> {
    const item = await this.itemRepo.findOne({ where: { ticketId, clientId } });

    if (!item) {
      return null;
    }

    const initiative = await this.initiativeRepo.findOne({ where: { id: item.initiativeId, clientId } });

    return initiative ? await this.buildSessionContext(initiative, { epicId: item.parentId ?? item.id }) : null;
  }

  // --- agent changes -----------------------------------------------------------------------------------------------

  /**
   * Ticket automation may only report findings on the story its running ticket is linked to (never proposals).
   * Throws 403 otherwise.
   */
  async assertAutomationFinding(clientId: string, runTicketId: string, change: InitiativeAgentChange): Promise<void> {
    if (change.operation !== 'initiative.finding') {
      throw new ForbiddenException(
        'Ticket automation may only record findings on its own story, never propose changes.',
      );
    }

    const item = await this.itemRepo.findOne({ where: { ticketId: runTicketId, clientId } });
    const initiative = item ? await this.initiativeRepo.findOne({ where: { id: item.initiativeId, clientId } }) : null;

    if (!item || !initiative || initiative.longSha !== change.sha) {
      throw new ForbiddenException("Automation runs only record findings on the initiative of their ticket's story.");
    }

    if (change.itemKey && change.itemKey !== item.key) {
      throw new ForbiddenException(`Automation runs only record findings on their own story (${item.key}).`);
    }

    change.itemKey = item.key;
  }

  /** Apply a proposal / finding of an agent (manager decided; workspace bound; never accepted automatically). */
  async applyAgentChange(writer: AgentContentWriter, change: InitiativeAgentChange): Promise<AgentContentChangeResult> {
    const initiative = await this.initiativeRepo.findOne({ where: { clientId: writer.clientId, longSha: change.sha } });

    if (!initiative) {
      throw new NotFoundException('Initiative not found in this workspace');
    }

    if (initiative.state === 'archived') {
      throw new BadRequestException('The initiative is archived');
    }

    const actor = this.initiatives.actorOf(writer);
    const origin = writer.source === 'task' ? 'task' : writer.source === 'automation' ? 'automation' : 'chat';

    if (change.operation === 'initiative.propose') {
      const proposal = parseInitiativeProposal({
        title: change.title,
        rationale: change.rationale,
        artifacts: change.artifacts,
        workItems: change.workItems,
        decisions: change.decisions,
      });

      if (!proposal || (!proposal.artifacts.length && !proposal.workItems.length && !proposal.decisions.length)) {
        throw new BadRequestException('The proposal has no valid document, work item change or decision');
      }

      await this.initiativeRepo.manager.transaction((em) =>
        this.learn.createProposal(em, initiative, proposal, { origin, actor }),
      );
    } else {
      const body = change.body?.trim();

      if (!body) {
        throw new BadRequestException('body is required');
      }

      const item = change.itemKey
        ? await this.itemRepo.findOne({ where: { initiativeId: initiative.id, key: change.itemKey } })
        : null;

      if (change.itemKey && !item) {
        throw new BadRequestException(`Unknown work item ${change.itemKey}`);
      }

      await this.initiativeRepo.manager.transaction((em) =>
        this.learn.recordFinding(em, initiative, actor, {
          workItemId: item?.id ?? null,
          source: origin,
          severity: isFindingSeverity(change.severity) ? change.severity : 'minor',
          body: body.slice(0, INITIATIVE_LIMITS.findingMaxLength),
          evidence: change.evidence,
        }),
      );
    }

    return {
      kind: 'initiative',
      sha: initiative.longSha as string,
      title: initiative.title,
      revision: String(initiative.version),
    };
  }
}
