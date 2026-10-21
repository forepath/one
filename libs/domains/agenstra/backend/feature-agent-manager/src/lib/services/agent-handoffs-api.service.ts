import {
  AGENT_HANDOFF_LIMITS,
  type AgentHandoffAgentSummary,
  type AgentHandoffAgentsResponse,
  type AgentHandoffControllerRequest,
  type AgentHandoffControllerResponse,
  type AgentHandoffCreateInput,
  type AgentHandoffProfileInput,
  type AgentHandoffRespondInput,
  type AgentHandoffResponse,
  type AgentHandoffSummary,
} from '@forepath/agenstra/shared/util-opencode-config';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { HANDOFF_PROFILE_RESUME_SESSION_SUFFIX } from '../constants/chat-session.constants';
import { AgentProviderFactory } from '../providers/agent-provider.factory';
import { AgentsRepository } from '../repositories/agents.repository';

import { AgentActiveTurnsService } from './agent-active-turns.service';
import { AgentChatSessionsService } from './agent-chat-sessions.service';

/**
 * Runtime hook provided by the agents gateway (registered on module init) so this service does not
 * depend on the gateway directly.
 */
export interface AgentHandoffsGatewayBridge {
  /** Ask a connected controller socket of this agent to handle a handoff operation of the agent. */
  requestControllerHandoffs(
    agentId: string,
    request: AgentHandoffControllerRequest,
  ): Promise<AgentHandoffControllerResponse>;
}

/** A profile request answers within the MCP tool timeout; generation keeps running and is stored afterwards. */
export const AGENT_HANDOFF_PROFILE_WAIT_MS = 150_000;

/**
 * Fixed prompt of the read-only profile turn. Nothing of the requesting agent reaches the peer, so a profile request
 * cannot be used to instruct another agent.
 */
export const AGENT_HANDOFF_PROFILE_PROMPT =
  'Other agents of your workspace want to know what you are responsible for, so they can decide which tasks to hand ' +
  'over to you. Do not change anything. Look at your workspace (README, AGENTS.md, project structure, configuration) ' +
  'and describe in at most 1500 characters: what this environment and its repository are, which areas, technologies ' +
  'and typical tasks you can take over, and what you cannot do. Answer with the profile text only, without preamble.';

/**
 * Agent-facing handoff API (called by the worker MCP server). Handoffs live in the agent-controller, which also
 * enforces that both agents belong to the same workspace; this service forwards requests of the authenticated agent
 * over the controller socket and determines the chat a handoff is made in.
 */
@Injectable()
export class AgentHandoffsApiService {
  private readonly logger = new Logger(AgentHandoffsApiService.name);
  private bridge?: AgentHandoffsGatewayBridge;
  /** Running profile generations per agent: concurrent requests share one turn. */
  private readonly profileGenerations = new Map<string, Promise<string>>();
  /** Model of each agent's most recent visible chat turn: default model of the target turn. */
  private readonly lastChatModelByAgent = new Map<string, string>();
  /** Model last used per visible chat (`agentId:chatId`): model of the turn that delivers a response there. */
  private readonly lastModelByChat = new Map<string, string>();

  constructor(
    private readonly activeTurns: AgentActiveTurnsService,
    private readonly chatSessions: AgentChatSessionsService,
    private readonly agentsRepository: AgentsRepository,
    private readonly providerFactory: AgentProviderFactory,
  ) {}

  registerBridge(bridge: AgentHandoffsGatewayBridge): void {
    this.bridge = bridge;
  }

  rememberChatModel(agentId: string, model: string | undefined, chatId?: string): void {
    const trimmed = typeof model === 'string' ? model.trim() : '';

    if (trimmed) {
      this.lastChatModelByAgent.set(agentId, trimmed);

      if (chatId) {
        this.lastModelByChat.set(`${agentId}:${chatId}`, trimmed);
      }
    }
  }

  /** Peers of the workspace (from the controller) plus the caller's own entry, so it can keep its profile current. */
  async agents(agentId: string): Promise<AgentHandoffAgentsResponse> {
    const [response, self] = await Promise.all([
      this.call({ op: 'agents', agentId }),
      this.agentsRepository.findById(agentId),
    ]);

    if (!self) {
      throw new NotFoundException('Agent not found');
    }

    return {
      self: {
        id: self.id,
        name: self.name,
        ...(self.description ? { description: self.description } : {}),
        ...(self.handoffProfile ? { handoffProfile: self.handoffProfile } : {}),
      },
      agents: response.agents ?? [],
    };
  }

  /** The agent maintains its own handoff profile (what peers read about it); empty clears it. */
  async updateProfile(agentId: string, input: AgentHandoffProfileInput): Promise<AgentHandoffAgentsResponse['self']> {
    const profile = input.profile.trim();
    const agent = await this.agentsRepository.update(agentId, { handoffProfile: profile || null });

    return {
      id: agent.id,
      name: agent.name,
      ...(agent.description ? { description: agent.description } : {}),
      ...(agent.handoffProfile ? { handoffProfile: agent.handoffProfile } : {}),
    };
  }

  /**
   * Metadata and handoff profile of one peer of the workspace (the controller's agent list is the workspace check).
   * A missing profile is generated first: the peer describes itself in a read-only hidden turn with a fixed prompt,
   * and the answer is stored as its profile.
   */
  async peerProfile(agentId: string, targetAgentId: string): Promise<AgentHandoffAgentSummary> {
    const { agents } = await this.call({ op: 'agents', agentId });
    const peer = (agents ?? []).find((agent) => agent.id === targetAgentId);

    if (!peer) {
      throw new NotFoundException('Target agent not found in this workspace');
    }

    if (peer.handoffProfile) {
      return peer;
    }

    let generation = this.profileGenerations.get(targetAgentId);

    if (!generation) {
      const model = this.lastChatModelByAgent.get(targetAgentId) ?? this.lastChatModelByAgent.get(agentId);

      generation = this.generateProfile(targetAgentId, model).finally(() =>
        this.profileGenerations.delete(targetAgentId),
      );
      this.profileGenerations.set(targetAgentId, generation);
    }

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new HttpException(
              `"${peer.name}" is still describing itself; ask again in a few minutes or hand off with its metadata.`,
              HttpStatus.GATEWAY_TIMEOUT,
            ),
          ),
        AGENT_HANDOFF_PROFILE_WAIT_MS,
      );
      timer.unref?.();
    });

    try {
      return { ...peer, handoffProfile: await Promise.race([generation, timeout]) };
    } finally {
      clearTimeout(timer);
    }
  }

  private async generateProfile(targetAgentId: string, model: string | undefined): Promise<string> {
    const agent = await this.agentsRepository.findById(targetAgentId);

    if (!agent?.containerId) {
      throw new NotFoundException('Target agent not found in this workspace');
    }

    let text = '';

    try {
      const provider = this.providerFactory.getProvider(agent.agentType || 'opencode');
      const raw = await provider.sendMessage(agent.id, agent.containerId, AGENT_HANDOFF_PROFILE_PROMPT, {
        ...(model ? { model } : {}),
        resumeSessionSuffix: HANDOFF_PROFILE_RESUME_SESSION_SUFFIX,
      });

      for (const line of provider.toParseableStrings(raw)) {
        const result = provider.toUnifiedResponse(line)?.result;

        if (typeof result === 'string' && result.trim()) {
          text = result.trim();
        }
      }
    } catch (error) {
      this.logger.warn(`Handoff profile generation failed for agent ${targetAgentId}: ${(error as Error).message}`);
    }

    if (!text) {
      throw new HttpException(
        'The agent could not describe itself right now (is its environment running?); use its metadata instead.',
        HttpStatus.BAD_GATEWAY,
      );
    }

    const profile = text.slice(0, AGENT_HANDOFF_LIMITS.profileMaxLength);
    const current = await this.agentsRepository.findById(targetAgentId);

    // A profile written meanwhile (console or the agent itself) wins over the generated one.
    if (current?.handoffProfile) {
      return current.handoffProfile;
    }

    await this.agentsRepository.update(targetAgentId, { handoffProfile: profile });

    return profile;
  }

  async create(agentId: string, input: AgentHandoffCreateInput): Promise<AgentHandoffResponse> {
    const sourceChatId = await this.resolveSourceChatId(agentId);
    const sourceModel =
      this.lastModelByChat.get(`${agentId}:${sourceChatId}`) ?? this.lastChatModelByAgent.get(agentId);
    const model = input.model ?? this.lastChatModelByAgent.get(input.targetAgentId) ?? sourceModel;

    return {
      handoff: this.requireHandoff(
        await this.call({
          op: 'create',
          agentId,
          sourceChatId,
          ...(sourceModel ? { sourceModel } : {}),
          input: { ...input, ...(model ? { model } : {}) },
        }),
      ),
    };
  }

  async get(agentId: string, handoffId: string): Promise<AgentHandoffResponse> {
    return { handoff: this.requireHandoff(await this.call({ op: 'get', agentId, handoffId })) };
  }

  async respond(agentId: string, handoffId: string, input: AgentHandoffRespondInput): Promise<AgentHandoffResponse> {
    return { handoff: this.requireHandoff(await this.call({ op: 'respond', agentId, handoffId, input })) };
  }

  /**
   * The chat the call comes from: the response is delivered there, so handoffs are refused whenever that chat cannot
   * be told reliably or a response could not arrive in time (hidden sessions end with their run).
   */
  private async resolveSourceChatId(agentId: string): Promise<string> {
    const calling = this.activeTurns.callingContext(agentId);

    switch (calling.kind) {
      case 'hidden':
        throw new BadRequestException(
          'Handoffs are only available in visible chats. Task runs, ticket automation and other background sessions ' +
            'end before a response could arrive; do the work yourself or ask the user to hand it off from a chat.',
        );
      case 'ambiguous':
        throw new ConflictException(
          'Another session of yours is working at the same time, so the chat that should receive the response is ' +
            'ambiguous. Try again when only this chat is working.',
        );
      case 'idle':
        throw new BadRequestException('Handoffs can only be created from a chat that is currently working.');
    }

    if (calling.context.kind === 'primary') {
      return (await this.chatSessions.ensurePrimarySession(agentId)).id;
    }

    try {
      return (await this.chatSessions.getSession(agentId, calling.context.chatId)).id;
    } catch {
      throw new BadRequestException('The chat this handoff was requested from no longer exists.');
    }
  }

  private requireHandoff(response: Extract<AgentHandoffControllerResponse, { ok: true }>): AgentHandoffSummary {
    if (!response.handoff) {
      throw new HttpException('Malformed handoff response from the controller', HttpStatus.BAD_GATEWAY);
    }

    return response.handoff;
  }

  private async call(
    request: AgentHandoffControllerRequest,
  ): Promise<Extract<AgentHandoffControllerResponse, { ok: true }>> {
    if (!this.bridge) {
      throw new ServiceUnavailableException('Handoffs are unavailable');
    }

    const response = await this.bridge.requestControllerHandoffs(request.agentId, request);

    if (response.ok === false) {
      const status = response.status && response.status >= 400 && response.status < 600 ? response.status : 502;

      throw new HttpException(response.error || 'Handoff request failed', status);
    }

    return response;
  }
}
