import { createHash } from 'crypto';

import { ACCOUNT_STATES, AccountStateTemplate, buildPersonalAccessTokenRows, buildUserRow } from '../core/accounts';
import { LOREM_SENTENCES, SOFTWARE_TOPICS, TICKET_VERBS } from '../core/fixtures';
import { createPerson } from '../core/people';
import { RowCollector } from '../core/row-collector';
import { json, SqlRow } from '../core/sql';

import {
  AgenstraSeedContext,
  DEMO_CHAT_MODELS,
  DEMO_WORKSPACES,
  DemoAgent,
  DemoWorkspaceSpec,
} from './agenstra-context';
import { ManagerFilterRule } from './agenstra-manager.builder';

const AGENSTRA_PAT_SCOPES = ['clients:read', 'clients:write', 'tickets:read', 'tickets:write', 'knowledge:read'];
const WEBHOOK_EVENTS = [
  'ticket.created',
  'ticket.updated',
  'ticket.comment.created',
  'client.created',
  'agent.chat.failed',
];
const TICKET_STATUSES = ['draft', 'todo', 'in_progress', 'prototype', 'done', 'closed'] as const;
const TICKET_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
const RUN_OUTCOMES = [
  { status: 'succeeded', phase: 'finalize', failureCode: null, activity: 'AUTOMATION_SUCCEEDED' },
  { status: 'failed', phase: 'verify', failureCode: 'verify_command_failed', activity: 'AUTOMATION_FAILED' },
  { status: 'timed_out', phase: 'agent_loop', failureCode: 'max_runtime_exceeded', activity: 'AUTOMATION_TIMED_OUT' },
  { status: 'escalated', phase: 'agent_loop', failureCode: 'budget_exceeded', activity: 'AUTOMATION_ESCALATED' },
  { status: 'cancelled', phase: 'workspace_prep', failureCode: null, activity: 'AUTOMATION_CANCELLED' },
] as const;

interface DemoUser {
  id: string;
  email: string;
  role: string;
  state: AccountStateTemplate;
  statisticsId: string;
}

interface DemoWorkspace {
  spec: DemoWorkspaceSpec;
  id: string;
  statisticsId: string;
  ownerId: string;
  members: { userId: string; role: 'admin' | 'user'; id: string; statisticsId: string }[];
  ticketIds: string[];
  ticketShas: Map<string, string>;
}

export interface ControllerSeedResult {
  loginEmails: string[];
}

export interface ControllerSeedOptions {
  managerEndpoint: string;
  managerApiKey: string;
  emailDomain: string;
  includeGlobalOpencodeConfig: boolean;
}

function sha1(value: string): string {
  return createHash('sha1').update(value).digest('hex');
}

export class AgenstraControllerBuilder {
  private readonly users: DemoUser[] = [];
  private readonly workspaces: DemoWorkspace[] = [];
  private readonly agentStatisticsIds = new Map<string, string>();

  constructor(
    private readonly context: AgenstraSeedContext,
    private readonly rows: RowCollector,
    private readonly agents: DemoAgent[],
    private readonly managerRules: ManagerFilterRule[],
    private readonly options: ControllerSeedOptions,
  ) {}

  async build(): Promise<ControllerSeedResult> {
    await this.addUsers();
    this.addWorkspaces();
    this.addAgentStatistics();

    for (const workspace of this.workspaces) {
      this.addTickets(workspace);
      this.addKnowledge(workspace);
      this.addReadState(workspace);
    }

    this.addAutomation();
    this.addChatStatistics();
    this.addFilterRules();
    this.addOpencodeConfig();
    this.addAtlassianImports();
    this.addNotifications();

    return { loginEmails: this.users.filter((user) => user.state.key !== 'random').map((user) => user.email) };
  }

  // ---------------------------------------------------------------------------
  // Users and workspaces
  // ---------------------------------------------------------------------------

  private async addUsers(): Promise<void> {
    const { random, hasher, controllerEncryptor } = this.context;
    const states: AccountStateTemplate[] = [
      ...ACCOUNT_STATES,
      { key: 'controller', role: 'controller', description: 'Service account for automation', confirmed: true },
    ];
    const usedLocalParts = new Set<string>(states.map((state) => state.key));
    const randomUserState: AccountStateTemplate = {
      ...ACCOUNT_STATES.find((state) => state.key === 'user')!,
      key: 'random',
    };
    const entries: { email: string; state: AccountStateTemplate }[] = [
      ...states.map((state) => ({ email: `${state.key}@${this.options.emailDomain}`, state })),
      ...Array.from({ length: 10 }, () => ({
        email: `${createPerson(random, usedLocalParts).emailLocalPart}@${this.options.emailDomain}`,
        state: randomUserState,
      })),
    ];

    for (const entry of entries) {
      const id = random.id();
      const createdAt = random.daysAgo(random.int(60, 500));

      this.rows.add(
        'users',
        await buildUserRow({
          id,
          tenantId: 'default',
          email: entry.email,
          state: entry.state,
          createdAt,
          random,
          hasher,
          encryptor: controllerEncryptor,
        }),
      );

      const statisticsId = random.id();

      this.rows.add('statistics_users', {
        id: statisticsId,
        original_user_id: id,
        role: entry.state.role,
        created_at: createdAt,
        updated_at: createdAt,
      });
      this.addEntityEvent('created', 'user', id, createdAt, {
        statistics_user_id: statisticsId,
        statistics_users_id: statisticsId,
      });
      this.users.push({ id, email: entry.email, role: entry.state.role, state: entry.state, statisticsId });

      if (entry.state.role === 'admin') {
        this.rows.addMany(
          'user_personal_access_tokens',
          await buildPersonalAccessTokenRows(random, hasher, id, AGENSTRA_PAT_SCOPES),
        );
      }
    }
  }

  private get admin(): DemoUser {
    return this.users.find((user) => user.state.key === 'admin')!;
  }

  private get activeUsers(): DemoUser[] {
    return this.users.filter((user) => user.state.confirmed && !user.state.locked && user.role !== 'controller');
  }

  private addWorkspaces(): void {
    const { random, controllerEncryptor } = this.context;
    const owners = this.activeUsers;

    for (const spec of DEMO_WORKSPACES) {
      const id = random.id();
      const statisticsId = random.id();
      const createdAt = random.daysAgo(random.int(150, 300));
      const owner = spec.key === 'webshop' ? this.admin : random.pick(owners);

      this.rows.add('clients', {
        id,
        name: spec.name,
        description: spec.description,
        endpoint: spec.reachable ? this.options.managerEndpoint : 'https://agents.remote-office.example:3000',
        authentication_type: spec.reachable ? 'api_key' : 'keycloak',
        api_key: spec.reachable ? controllerEncryptor.encrypt(this.options.managerApiKey) : null,
        keycloak_client_id: spec.reachable ? null : 'agent-manager',
        keycloak_client_secret: spec.reachable ? null : controllerEncryptor.encrypt(random.alphanumeric(32)),
        keycloak_realm: spec.reachable ? null : 'agenstra',
        user_id: owner.id,
        created_at: createdAt,
        updated_at: createdAt,
      });
      this.rows.add('statistics_clients', {
        id: statisticsId,
        original_client_id: id,
        name: spec.name,
        endpoint: spec.reachable ? this.options.managerEndpoint : 'https://agents.remote-office.example:3000',
        authentication_type: spec.reachable ? 'api_key' : 'keycloak',
        created_at: createdAt,
        updated_at: createdAt,
      });
      this.addEntityEvent('created', 'client', id, createdAt, { statistics_clients_id: statisticsId });

      const workspace: DemoWorkspace = {
        spec,
        id,
        statisticsId,
        ownerId: owner.id,
        members: [],
        ticketIds: [],
        ticketShas: new Map(),
      };
      const memberCandidates = this.users.filter((user) => user.id !== owner.id && user.role !== 'controller');

      for (const [index, member] of random.pickMany(memberCandidates, random.int(4, 8)).entries()) {
        const membership = {
          userId: member.id,
          role: (index === 0 ? 'admin' : 'user') as 'admin' | 'user',
          id: random.id(),
          statisticsId: random.id(),
        };

        workspace.members.push(membership);
        this.rows.add('client_users', {
          id: membership.id,
          user_id: member.id,
          client_id: id,
          role: membership.role,
          created_at: createdAt,
          updated_at: createdAt,
        });
        this.rows.add('statistics_client_users', {
          id: membership.statisticsId,
          original_client_user_id: membership.id,
          statistics_client_id: statisticsId,
          statistics_user_id: member.statisticsId,
          role: membership.role,
          created_at: createdAt,
          updated_at: createdAt,
        });
        this.addEntityEvent('created', 'client_user', membership.id, createdAt, {
          statistics_client_users_id: membership.statisticsId,
        });
      }

      if (spec.reachable) {
        // The local manager lists all of its agents for every workspace pointing at it, so each
        // workspace needs credentials for every agent to open chats.
        for (const agent of this.agents) {
          this.rows.add('client_agent_credentials', {
            id: random.id(),
            client_id: id,
            agent_id: agent.id,
            password: controllerEncryptor.encrypt(agent.password),
            created_at: agent.createdAt,
            updated_at: agent.createdAt,
          });
        }
      } else {
        this.addProvisioningReference(workspace, createdAt);
      }

      this.workspaces.push(workspace);
    }
  }

  private addProvisioningReference(workspace: DemoWorkspace, createdAt: Date): void {
    const { random, controllerEncryptor } = this.context;
    const id = random.id();
    const statisticsId = random.id();
    const serverId = String(random.int(40000000, 49999999));
    const publicIp = `198.51.100.${random.int(2, 254)}`;
    const metadata = controllerEncryptor.encryptJson({ location: 'fsn1', serverType: 'cx32', image: 'ubuntu-24.04' });

    this.rows.add('provisioning_references', {
      id,
      client_id: workspace.id,
      provider_type: 'hetzner',
      server_id: serverId,
      server_name: 'agents-remote-office',
      public_ip: publicIp,
      private_ip: '10.0.0.2',
      provider_metadata: metadata,
      created_at: createdAt,
      updated_at: createdAt,
    });
    this.rows.add('statistics_provisioning_references', {
      id: statisticsId,
      original_provisioning_reference_id: id,
      statistics_client_id: workspace.statisticsId,
      provider_type: 'hetzner',
      server_id: serverId,
      server_name: 'agents-remote-office',
      public_ip: publicIp,
      private_ip: '10.0.0.2',
      provider_metadata: metadata,
      created_at: createdAt,
      updated_at: createdAt,
    });
    this.addEntityEvent('created', 'provisioning_reference', id, createdAt, {
      statistics_provisioning_references_id: statisticsId,
    });
  }

  private addAgentStatistics(): void {
    const { random } = this.context;

    for (const agent of this.agents) {
      const workspace = this.workspaces.find((candidate) => candidate.spec.key === agent.homeWorkspaceKey)!;
      const statisticsId = random.id();

      this.agentStatisticsIds.set(agent.id, statisticsId);
      this.rows.add('statistics_agents', {
        id: statisticsId,
        original_agent_id: agent.id,
        statistics_client_id: workspace.statisticsId,
        agent_type: 'opencode',
        container_type: agent.containerType,
        name: agent.name,
        description: `Coding agent ${agent.name}`,
        created_at: agent.createdAt,
        updated_at: agent.createdAt,
      });
      this.addEntityEvent('created', 'agent', agent.id, agent.createdAt, { statistics_agents_id: statisticsId });
    }
  }

  private addEntityEvent(
    eventType: 'created' | 'updated' | 'deleted',
    entityType: string,
    originalId: string,
    occurredAt: Date,
    references: SqlRow,
  ): void {
    this.rows.add('statistics_entity_events', {
      id: this.context.random.id(),
      event_type: eventType,
      entity_type: entityType,
      original_entity_id: originalId,
      occurred_at: occurredAt,
      ...references,
    });
  }

  // ---------------------------------------------------------------------------
  // Tickets
  // ---------------------------------------------------------------------------

  private addTickets(workspace: DemoWorkspace): void {
    const { random } = this.context;
    const statusDeck = random.deck(TICKET_STATUSES);
    const priorityDeck = random.deck(TICKET_PRIORITIES);
    const authors = [workspace.ownerId, ...workspace.members.map((member) => member.userId)];
    const workspaceAgents = this.agents.filter((agent) => agent.homeWorkspaceKey === workspace.spec.key);
    const count = random.int(16, 24);

    for (let i = 0; i < count; i++) {
      const id = random.id();
      const longSha = sha1(id);
      const status = statusDeck();
      const createdAt = random.daysAgo(random.int(1, 120), 12);
      const authorId = random.pick(authors);
      const parentId = workspace.ticketIds.length > 3 && random.chance(0.25) ? random.pick(workspace.ticketIds) : null;
      const title = `${random.pick(TICKET_VERBS)} ${random.pick(SOFTWARE_TOPICS)}`;

      workspace.ticketIds.push(id);
      workspace.ticketShas.set(id, longSha);
      this.rows.add('tickets', {
        id,
        client_id: workspace.id,
        parent_id: parentId,
        title,
        content: [
          '## Problem',
          random.pick(LOREM_SENTENCES),
          '',
          '## Acceptance criteria',
          ...random.pickMany(LOREM_SENTENCES, 3).map((sentence) => `- [ ] ${sentence}`),
        ].join('\n'),
        long_sha: longSha,
        priority: priorityDeck(),
        status,
        created_by_user_id: authorId,
        preferred_chat_agent_id: workspaceAgents.length && random.chance(0.6) ? random.pick(workspaceAgents).id : null,
        preferred_chat_model: random.chance(0.5) ? random.pick(DEMO_CHAT_MODELS) : null,
        created_at: createdAt,
        updated_at: random.addDays(createdAt, random.int(0, 5)),
      });
      this.addTicketActivity(workspace, { id, title, status, createdAt, authorId, parentId }, authors);
    }
  }

  private addTicketActivity(
    workspace: DemoWorkspace,
    ticket: { id: string; title: string; status: string; createdAt: Date; authorId: string; parentId: string | null },
    authors: string[],
  ): void {
    const { random } = this.context;
    const { id: ticketId, status, createdAt, authorId, parentId } = ticket;
    const activity = (actorType: string, actorUserId: string | null, actionType: string, payload: object, at: Date) =>
      this.rows.add('ticket_activity', {
        id: random.id(),
        ticket_id: ticketId,
        occurred_at: at,
        actor_type: actorType,
        actor_user_id: actorUserId,
        action_type: actionType,
        payload: json(payload),
      });

    activity('human', authorId, 'CREATED', { title: ticket.title, clientId: workspace.id, parentId }, createdAt);

    if (random.chance(0.3)) {
      const generatedAt = random.addMinutes(createdAt, 5);

      activity('human', authorId, 'BODY_GENERATION_STARTED', {}, generatedAt);
      activity('ai', null, 'CONTENT_APPLIED_FROM_AI', { fields: ['content'] }, random.addMinutes(generatedAt, 1));
      this.rows.add('ticket_body_generation_sessions', {
        id: random.id(),
        ticket_id: ticketId,
        user_id: authorId,
        agent_id: random.pick(this.agents).id,
        expires_at: random.addMinutes(generatedAt, 30),
        consumed_at: random.chance(0.7) ? random.addMinutes(generatedAt, 1) : null,
        created_at: generatedAt,
      });
    }

    if (status !== 'draft') {
      activity(
        'human',
        random.pick(authors),
        'STATUS_CHANGED',
        { fields: { status: { old: 'draft', new: status } } },
        random.addDays(createdAt, 1),
      );
    }

    if (random.chance(0.3)) {
      activity(
        'human',
        random.pick(authors),
        'PRIORITY_CHANGED',
        { fields: { priority: { old: 'medium', new: 'high' } } },
        random.addDays(createdAt, 2),
      );
    }

    const count = random.int(0, 4);

    for (let i = 0; i < count; i++) {
      const commentId = random.id();
      const commentAuthor = random.pick(authors);
      const commentedAt = random.addDays(createdAt, i + 1);

      this.rows.add('ticket_comments', {
        id: commentId,
        ticket_id: ticketId,
        author_user_id: commentAuthor,
        body: random.pick(LOREM_SENTENCES),
        created_at: commentedAt,
      });
      activity('human', commentAuthor, 'COMMENT_ADDED', { commentId }, commentedAt);
    }
  }

  // ---------------------------------------------------------------------------
  // Automation
  // ---------------------------------------------------------------------------

  private addAutomation(): void {
    const { random } = this.context;
    const reachable = this.workspaces.filter((workspace) => workspace.spec.reachable);

    for (const workspace of reachable) {
      const workspaceAgents = this.agents.filter((agent) => agent.homeWorkspaceKey === workspace.spec.key);

      workspaceAgents.forEach((agent, index) => {
        this.rows.add('client_agent_autonomy', {
          client_id: workspace.id,
          agent_id: agent.id,
          // Only the first agent per workspace is enabled; see the scheduler note below.
          enabled: index === 0,
          pre_improve_ticket: random.chance(0.5),
          max_runtime_ms: 3600000,
          max_iterations: random.pick([10, 20, 30]),
          token_budget_limit: random.pick([null, 200000, 500000]),
          created_at: agent.createdAt,
          updated_at: agent.createdAt,
        });
      });

      if (workspaceAgents.length === 0) {
        continue;
      }

      for (const ticketId of random.pickMany(workspace.ticketIds, 6)) {
        this.addTicketAutomation(workspace, ticketId, workspaceAgents);
      }
    }
  }

  private addTicketAutomation(workspace: DemoWorkspace, ticketId: string, agents: DemoAgent[]): void {
    const { random } = this.context;
    const ticketRow = this.findTicketRow(ticketId);
    const ticketStatus = ticketRow.status as string;
    // The scheduler starts runs for eligible todo/in_progress tickets with an approved, enabled agent.
    // Open tickets therefore either require (missing) approval or stay ineligible.
    const open = ticketStatus === 'todo' || ticketStatus === 'in_progress';
    const requiresApproval = open || random.chance(0.3);
    const createdAt = random.addDays(ticketRow.created_at as Date, 1);

    this.rows.add('ticket_automation', {
      ticket_id: ticketId,
      eligible: open ? random.chance(0.5) : true,
      allowed_agent_ids: json(agents.map((agent) => agent.id)),
      preferred_model: random.pick(DEMO_CHAT_MODELS),
      include_workspace_context: true,
      context_environment_ids: json([]),
      auto_enrichment_enabled: random.chance(0.7),
      verifier_profile: json({ commands: [{ cmd: 'npm test' }, { cmd: 'npm run lint' }] }),
      requires_approval: requiresApproval,
      approved_at: requiresApproval && !open ? random.addDays(createdAt, 1) : null,
      approved_by_user_id: requiresApproval && !open ? workspace.ownerId : null,
      approval_baseline_ticket_updated_at: null,
      default_branch_override: null,
      automation_branch_strategy: random.pick(['reuse_per_ticket', 'new_per_run']),
      force_new_automation_branch_next_run: false,
      next_retry_at: null,
      consecutive_failure_count: 0,
      created_at: createdAt,
      updated_at: createdAt,
    });

    if (open) {
      return;
    }

    const runCount = random.int(1, 3);
    let lastRunId: string | null = null;
    let lastAgentId: string | null = null;
    let lastFinishedAt = createdAt;

    for (let i = 0; i < runCount; i++) {
      const outcome = i === runCount - 1 && ticketStatus === 'done' ? RUN_OUTCOMES[0] : random.pick(RUN_OUTCOMES);
      const agent = random.pick(agents);
      const runId = random.id();
      const startedAt = random.addMinutes(lastFinishedAt, random.int(30, 600));
      const finishedAt = random.addMinutes(startedAt, random.int(3, 55));
      const iterations = outcome.status === 'cancelled' ? 0 : random.int(2, 18);

      this.rows.add('ticket_automation_run', {
        id: runId,
        ticket_id: ticketId,
        client_id: workspace.id,
        agent_id: agent.id,
        status: outcome.status,
        phase: outcome.phase,
        ticket_status_before: 'todo',
        branch_name: `automation/${sha1(ticketId).slice(0, 8)}${i > 0 ? `-${i + 1}` : ''}`,
        base_branch: 'main',
        base_sha: random.hex(40),
        started_at: startedAt,
        finished_at: finishedAt,
        updated_at: finishedAt,
        iteration_count: iterations,
        completion_signal_seen: outcome.status === 'succeeded',
        verification_passed: outcome.status === 'succeeded' ? true : outcome.status === 'failed' ? false : null,
        failure_code: outcome.failureCode,
        summary: json({
          filesChanged: random.int(1, 12),
          commits: outcome.status === 'succeeded' ? random.int(1, 4) : 0,
          note: random.pick(LOREM_SENTENCES),
        }),
        cancel_requested_at: outcome.status === 'cancelled' ? random.addMinutes(startedAt, 1) : null,
        cancelled_by_user_id: outcome.status === 'cancelled' ? workspace.ownerId : null,
        cancellation_reason: outcome.status === 'cancelled' ? 'user_requested' : null,
      });
      this.addRunSteps(runId, outcome.status, startedAt, iterations);
      this.rows.add('ticket_activity', {
        id: random.id(),
        ticket_id: ticketId,
        occurred_at: finishedAt,
        actor_type: 'system',
        actor_user_id: null,
        action_type: outcome.activity,
        payload: json({ runId, code: outcome.failureCode }),
      });
      lastRunId = runId;
      lastAgentId = agent.id;
      lastFinishedAt = finishedAt;
    }

    if (lastRunId && lastAgentId) {
      this.rows.add('ticket_automation_lease', {
        ticket_id: ticketId,
        holder_agent_id: lastAgentId,
        run_id: lastRunId,
        lease_version: runCount,
        expires_at: random.addMinutes(lastFinishedAt, 5),
        status: random.chance(0.8) ? 'released' : 'expired',
        created_at: lastFinishedAt,
        updated_at: lastFinishedAt,
      });
    }
  }

  private addRunSteps(runId: string, status: string, startedAt: Date, iterations: number): void {
    const { random } = this.context;
    const steps: { phase: string; kind: string; excerpt: string | null }[] = [
      { phase: 'workspace_prep', kind: 'vcs_prepare', excerpt: 'Fetched origin and checked out main' },
      { phase: 'workspace_prep', kind: 'vcs_branch', excerpt: 'Created automation branch' },
    ];

    if (status !== 'cancelled') {
      for (let i = 0; i < Math.min(iterations, 4); i++) {
        steps.push({ phase: 'agent_loop', kind: 'agent_turn', excerpt: random.pick(LOREM_SENTENCES) });
      }
    }

    if (status === 'succeeded') {
      steps.push(
        { phase: 'finalize', kind: 'git_commit', excerpt: 'feat: implement requested change' },
        { phase: 'finalize', kind: 'git_push', excerpt: 'Pushed automation branch' },
      );
    }

    steps.push({ phase: 'finalize', kind: 'clean', excerpt: null });
    steps.forEach((step, index) => {
      this.rows.add('ticket_automation_run_step', {
        id: random.id(),
        run_id: runId,
        step_index: index,
        phase: step.phase,
        kind: step.kind,
        payload: json({}),
        excerpt: step.excerpt,
        created_at: random.addMinutes(startedAt, index * 2),
      });
    });
  }

  private findTicketRow(ticketId: string): SqlRow {
    return this.rowsOf('tickets').find((row) => row.id === ticketId)!;
  }

  private rowsOf(table: string): SqlRow[] {
    return this.rows.rowsFor(table);
  }

  // ---------------------------------------------------------------------------
  // Knowledge
  // ---------------------------------------------------------------------------

  private addKnowledge(workspace: DemoWorkspace): void {
    const { random } = this.context;
    const authors = [workspace.ownerId, ...workspace.members.map((member) => member.userId)];
    const tree: { title: string; pages: string[]; children?: { title: string; pages: string[] }[] }[] = [
      {
        title: 'Architecture',
        pages: ['System overview', 'Decision log', 'Integration points'],
        children: [{ title: 'Decision records', pages: ['ADR-001: Use PostgreSQL', 'ADR-002: Event-driven sync'] }],
      },
      { title: 'Runbooks', pages: ['Deploying to production', 'Rotating secrets', 'Incident checklist'] },
      { title: 'Onboarding', pages: ['Local setup', 'Coding guidelines'] },
    ];
    const pageIds: string[] = [];
    const addNode = (type: 'folder' | 'page', title: string, parentId: string | null, sortOrder: number): string => {
      const id = random.id();
      const createdAt = random.daysAgo(random.int(10, 140));

      this.rows.add('knowledge_nodes', {
        id,
        client_id: workspace.id,
        node_type: type,
        parent_id: parentId,
        title,
        content: type === 'page' ? this.pageContent(title, workspace) : null,
        sort_order: sortOrder,
        long_sha: sha1(id),
        created_at: createdAt,
        updated_at: random.addDays(createdAt, random.int(0, 9)),
      });

      if (type === 'page') {
        pageIds.push(id);
        this.addPageActivity(id, createdAt, random.pick(authors));
      }

      return id;
    };

    tree.forEach((folder, folderIndex) => {
      const folderId = addNode('folder', folder.title, null, folderIndex);

      folder.pages.forEach((page, pageIndex) => addNode('page', page, folderId, pageIndex));
      folder.children?.forEach((child, childIndex) => {
        const childId = addNode('folder', child.title, folderId, folder.pages.length + childIndex);

        child.pages.forEach((page, pageIndex) => addNode('page', page, childId, pageIndex));
      });
    });

    addNode('page', 'Glossary', null, tree.length);

    for (let i = 0; i < 6; i++) {
      const ticketId = random.pick(workspace.ticketIds);
      const pageId = random.pick(pageIds);
      const pageToTicket = random.chance(0.5);

      this.rows.add('knowledge_relations', {
        id: random.id(),
        client_id: workspace.id,
        source_type: pageToTicket ? 'page' : 'ticket',
        source_id: pageToTicket ? pageId : ticketId,
        target_type: pageToTicket ? 'ticket' : 'page',
        target_node_id: pageToTicket ? null : pageId,
        target_ticket_long_sha: pageToTicket ? workspace.ticketShas.get(ticketId) : null,
        created_at: random.daysAgo(random.int(1, 30)),
      });
    }
  }

  private pageContent(title: string, workspace: DemoWorkspace): string {
    const body = this.context.random.pickMany(LOREM_SENTENCES, 4);

    return [`# ${title}`, '', `Applies to ${workspace.spec.name}.`, '', ...body].join('\n');
  }

  private addPageActivity(pageId: string, createdAt: Date, authorId: string): void {
    const { random } = this.context;

    this.rows.add('knowledge_page_activity', {
      id: random.id(),
      page_id: pageId,
      occurred_at: createdAt,
      actor_type: 'human',
      actor_user_id: authorId,
      action_type: 'CREATED',
      payload: json({}),
    });

    if (random.chance(0.6)) {
      this.rows.add('knowledge_page_activity', {
        id: random.id(),
        page_id: pageId,
        occurred_at: random.addDays(createdAt, random.int(1, 9)),
        actor_type: random.pick(['human', 'ai']),
        actor_user_id: authorId,
        action_type: 'CONTENT_UPDATED',
        payload: json({}),
      });
    }
  }

  private addReadState(workspace: DemoWorkspace): void {
    const { random } = this.context;

    if (!workspace.spec.reachable) {
      return;
    }

    for (const agent of this.agents.filter((candidate) => candidate.homeWorkspaceKey === workspace.spec.key)) {
      this.rows.add('user_environment_read_state', {
        id: random.id(),
        user_id: this.admin.id,
        client_id: workspace.id,
        agent_id: agent.id,
        last_read_at: random.daysAgo(random.int(0, 5)),
        last_read_agent_message_id: null,
        created_at: agent.createdAt,
        updated_at: random.daysAgo(0),
      });
      this.rows.add('user_chat_session_read_state', {
        id: random.id(),
        user_id: this.admin.id,
        client_id: workspace.id,
        agent_id: agent.id,
        chat_session_id: agent.chatSessionIds[0],
        last_read_at: random.daysAgo(random.int(0, 5)),
        last_read_agent_message_id: null,
        created_at: agent.createdAt,
        updated_at: random.daysAgo(0),
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Statistics
  // ---------------------------------------------------------------------------

  private addChatStatistics(): void {
    const { random } = this.context;
    const interactionKinds = [
      'chat',
      'chat',
      'chat',
      'prompt_enhancement',
      'ticket_body_generation',
      'autonomous_ticket_run',
      'autonomous_ticket_run_turn',
      'autonomous_ticket_commit_message',
      'auto_context_enrichment',
    ];

    for (const agent of this.agents) {
      const workspace = this.workspaces.find((candidate) => candidate.spec.key === agent.homeWorkspaceKey)!;
      const statisticsAgentId = this.agentStatisticsIds.get(agent.id)!;
      const participants = this.users.filter((user) =>
        [workspace.ownerId, ...workspace.members.map((member) => member.userId)].includes(user.id),
      );

      for (let day = 45; day >= 0; day--) {
        const interactions = random.int(0, day % 7 >= 5 ? 2 : 8);

        for (let i = 0; i < interactions; i++) {
          const occurredAt = random.daysAgo(day, 20);
          const user = random.pick(participants);
          const kind = random.pick(interactionKinds);
          const inputWords = random.int(8, 160);
          const outputWords = random.int(40, 900);
          const base = {
            statistics_agent_id: statisticsAgentId,
            statistics_client_id: workspace.statisticsId,
            statistics_user_id: kind.startsWith('autonomous') ? null : user.statisticsId,
            interaction_kind: kind,
          };

          this.rows.add('statistics_chat_io', {
            id: random.id(),
            ...base,
            direction: 'input',
            word_count: inputWords,
            char_count: inputWords * 6,
            input_tokens: inputWords * 2 + random.int(500, 4000),
            output_tokens: null,
            reasoning_tokens: null,
            cache_read_tokens: random.int(0, 20000),
            cache_write_tokens: random.int(0, 4000),
            cost_usd: null,
            occurred_at: occurredAt,
          });
          this.rows.add('statistics_chat_io', {
            id: random.id(),
            ...base,
            direction: 'output',
            word_count: outputWords,
            char_count: outputWords * 6,
            input_tokens: null,
            output_tokens: outputWords * 2,
            reasoning_tokens: random.int(0, 3000),
            cache_read_tokens: null,
            cache_write_tokens: null,
            cost_usd: random.decimal(0.002, 0.45, 6),
            occurred_at: random.addMinutes(occurredAt, random.int(1, 4)),
          });

          if (random.chance(0.05)) {
            const table = random.chance(0.5) ? 'statistics_chat_filter_drops' : 'statistics_chat_filter_flags';
            const { interaction_kind: _kind, ...filterBase } = base;

            this.rows.add(table, {
              id: random.id(),
              ...filterBase,
              filter_type: 'regex',
              filter_display_name: table.endsWith('drops') ? 'Credit card numbers' : 'API keys',
              filter_reason: table.endsWith('drops') ? 'Message dropped by filter rule' : 'Sensitive content redacted',
              direction: random.pick(['incoming', 'outgoing']),
              word_count: inputWords,
              char_count: inputWords * 6,
              occurred_at: occurredAt,
            });
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Filter rules, OpenCode configuration, imports and notifications
  // ---------------------------------------------------------------------------

  private addFilterRules(): void {
    const { random } = this.context;
    const reachable = this.workspaces.filter((workspace) => workspace.spec.reachable);
    // The disabled rule was never pushed to a manager, so it has no manager-side counterpart.
    const disabledRule: Omit<ManagerFilterRule, 'id'> & { id: null } = {
      id: null,
      pattern: 'internal-only',
      direction: 'incoming',
      filterType: 'none',
      replaceContent: null,
    };
    const specs = [
      { managerRule: this.managerRules[0], isGlobal: true, enabled: true },
      { managerRule: this.managerRules[1], isGlobal: false, enabled: true },
      { managerRule: disabledRule, isGlobal: false, enabled: false },
    ];

    specs.forEach((spec, index) => {
      const ruleId = random.id();
      const createdAt = random.daysAgo(random.int(20, 90));
      const targets = spec.isGlobal ? reachable : random.pickMany(this.workspaces, 2);

      this.rows.add('agent_console_regex_filter_rules', {
        id: ruleId,
        pattern: spec.managerRule.pattern,
        regex_flags: spec.enabled ? 'g' : 'gi',
        direction: spec.managerRule.direction,
        filter_type: spec.managerRule.filterType,
        replace_content: spec.managerRule.replaceContent,
        priority: index * 10,
        enabled: spec.enabled,
        is_global: spec.isGlobal,
        created_at: createdAt,
        updated_at: createdAt,
      });

      for (const workspace of targets) {
        if (!spec.isGlobal) {
          this.rows.add('agent_console_regex_filter_rule_clients', {
            id: random.id(),
            rule_id: ruleId,
            client_id: workspace.id,
          });
        }

        const synced = workspace.spec.reachable && spec.managerRule.id !== null;

        this.rows.add('agent_console_regex_filter_rule_sync_targets', {
          id: random.id(),
          rule_id: ruleId,
          client_id: workspace.id,
          manager_rule_id: synced ? spec.managerRule.id : null,
          desired_on_manager: spec.enabled,
          sync_status: synced ? 'synced' : spec.enabled ? 'failed' : 'synced',
          last_error: !synced && spec.enabled ? 'Failed to connect to client endpoint' : null,
          last_synced_at: synced ? random.daysAgo(random.int(0, 3)) : null,
          updated_at: random.daysAgo(0),
        });
      }
    });
  }

  private addOpencodeConfig(): void {
    const { random, controllerEncryptor } = this.context;

    for (const workspace of this.workspaces.filter((candidate) => candidate.spec.reachable)) {
      this.rows.add('client_opencode_config', {
        id: random.id(),
        client_id: workspace.id,
        config: json({
          model: random.pick(DEMO_CHAT_MODELS),
          mcp_allow: ['io.modelcontextprotocol/filesystem', 'io.github.github/github-mcp-server'],
          mcp_deny: workspace.spec.key === 'mobile' ? ['custom'] : [],
          instructions: [`Follow the ${workspace.spec.topic} coding guidelines in the knowledge base.`],
        }),
        overrides: json({}),
        locks: json([]),
        secrets: controllerEncryptor.encryptJson({}),
        created_at: random.daysAgo(60),
        updated_at: random.daysAgo(random.int(0, 20)),
      });
    }

    if (this.options.includeGlobalOpencodeConfig) {
      this.rows.add('global_opencode_config', {
        id: random.id(),
        config: json({
          mcp_allow: [
            'io.modelcontextprotocol/filesystem',
            'io.github.github/github-mcp-server',
            'com.atlassian/atlassian-mcp-server',
          ],
          mcp_deny: ['io.example/untrusted-shell'],
          model_deny: ['ollama/*'],
        }),
        overrides: json({}),
        locks: json(['mcp_deny']),
        secrets: controllerEncryptor.encryptJson({}),
        created_at: random.daysAgo(90),
        updated_at: random.daysAgo(10),
      });
    }
  }

  private addAtlassianImports(): void {
    const { random, controllerEncryptor } = this.context;
    const connectionId = random.id();
    const [jiraWorkspace, confluenceWorkspace] = this.workspaces;
    const createdAt = random.daysAgo(60);

    this.rows.add('atlassian_site_connections', {
      id: connectionId,
      label: 'Company Atlassian',
      base_url: 'https://example-company.atlassian.net',
      account_email: `integrations@${this.options.emailDomain}`,
      api_token: controllerEncryptor.encrypt(`ATATT3x${random.alphanumeric(40)}`),
      created_at: createdAt,
      updated_at: createdAt,
    });

    const jiraConfigId = random.id();
    const confluenceConfigId = random.id();
    const parentFolder = this.rowsOf('knowledge_nodes').find(
      (row) => row.client_id === confluenceWorkspace.id && row.node_type === 'folder',
    );

    this.rows.add('external_import_configs', {
      id: jiraConfigId,
      provider: 'atlassian',
      import_kind: 'jira',
      atlassian_connection_id: connectionId,
      client_id: jiraWorkspace.id,
      // Disabled so the scheduler does not call the (fictional) Atlassian site.
      enabled: false,
      jira_board_id: 42,
      jql: 'project = SHOP AND statusCategory != Done',
      import_target_ticket_status: 'draft',
      agenstra_parent_ticket_id: jiraWorkspace.ticketIds[0],
      agenstra_parent_folder_id: null,
      last_run_at: random.daysAgo(2),
      last_error: null,
      created_at: createdAt,
      updated_at: createdAt,
    });
    this.rows.add('external_import_configs', {
      id: confluenceConfigId,
      provider: 'atlassian',
      import_kind: 'confluence',
      atlassian_connection_id: connectionId,
      client_id: confluenceWorkspace.id,
      enabled: false,
      confluence_space_key: 'MOB',
      confluence_root_page_id: '123456789',
      cql: null,
      agenstra_parent_ticket_id: null,
      agenstra_parent_folder_id: parentFolder?.id ?? null,
      last_run_at: random.daysAgo(3),
      last_error: '401 Unauthorized: API token expired',
      created_at: createdAt,
      updated_at: createdAt,
    });

    jiraWorkspace.ticketIds.slice(1, 4).forEach((ticketId, index) => {
      this.rows.add('external_import_sync_markers', {
        id: random.id(),
        import_config_id: jiraConfigId,
        external_type: 'jira_issue',
        external_id: `SHOP-${101 + index}`,
        local_ticket_id: ticketId,
        local_knowledge_node_id: null,
        content_hash: random.hex(64),
        last_imported_at: random.daysAgo(2),
        created_at: createdAt,
        updated_at: createdAt,
      });
    });
  }

  private addNotifications(): void {
    const { random, controllerEncryptor } = this.context;
    const endpoints = [
      { name: 'Team chat', url: 'https://chat.example.com/hooks', auth: 'none', enabled: true, failures: 0 },
      { name: 'Tracker sync', url: 'https://tracker.example.com/h', auth: 'query_param', enabled: true, failures: 3 },
      { name: 'Old automation', url: 'https://ops.example.org/h', auth: 'authorization', enabled: false, failures: 30 },
    ];

    for (const endpoint of endpoints) {
      const endpointId = random.id();
      const createdAt = random.daysAgo(random.int(30, 200));

      this.rows.add('webhook_endpoints', {
        id: endpointId,
        scope_key: 'instance',
        client_id: null,
        name: endpoint.name,
        url: endpoint.url,
        http_method: endpoint.auth === 'query_param' ? 'GET' : 'POST',
        subscribed_events: json(random.pickMany(WEBHOOK_EVENTS, random.int(2, WEBHOOK_EVENTS.length))),
        enabled: endpoint.enabled,
        auth_type: endpoint.auth,
        auth_header_name: endpoint.auth === 'query_param' ? 'token' : null,
        auth_value: endpoint.auth === 'none' ? null : controllerEncryptor.encrypt(random.alphanumeric(24)),
        signing_secret: controllerEncryptor.encrypt(`whsec_${random.alphanumeric(32)}`),
        consecutive_failures: endpoint.failures,
        disabled_reason: endpoint.enabled ? null : 'Disabled after 30 consecutive failures',
        delivery_log_retention_days: 14,
        delivery_log_max_entries: 200,
        created_at: createdAt,
        updated_at: createdAt,
      });

      const count = random.int(4, 10);

      for (let i = 0; i < count; i++) {
        const success = endpoint.enabled && random.chance(endpoint.failures > 0 ? 0.6 : 0.95);

        this.rows.add('webhook_deliveries', {
          id: random.id(),
          endpoint_id: endpointId,
          event_id: random.id(),
          event_type: random.pick(WEBHOOK_EVENTS),
          payload: json({ demo: true }),
          http_status: success ? 200 : random.pick([403, 500, 503]),
          response_body: success ? 'ok' : 'Service unavailable',
          success,
          attempt: success ? 1 : random.int(1, 5),
          error_message: success ? null : 'Request failed with non-2xx status',
          created_at: random.pastDate(20, 0),
        });
      }
    }

    for (let i = 0; i < 20; i++) {
      const success = random.chance(0.9);

      this.rows.add('email_deliveries', {
        id: random.id(),
        event_id: random.id(),
        event_type: random.pick(['ticket.comment.created', 'identity.email_confirmation', 'identity.login_2fa']),
        scope_key: 'instance',
        template_key: random.pick(['ticket-comment-created', 'email-confirmation', 'login-2fa-code']),
        recipient: controllerEncryptor.encrypt(random.pick(this.users).email),
        template_context: controllerEncryptor.encryptJson({ demo: true }),
        success,
        attempt: success ? 1 : random.int(2, 4),
        error_message: success ? null : controllerEncryptor.encrypt('SMTP connection refused'),
        created_at: random.pastDate(30, 0),
      });
    }
  }
}
