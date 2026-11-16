import { randomBytes, randomUUID } from 'node:crypto';

import type { ClientToolChoice, ClientToolDefinition } from '@forepath/agenstra/shared/util-opencode-config';
import {
  ClientUsersRepository,
  ensureClientAccess,
  getUserFromRequest,
  RequireScopes,
  type RequestWithUser,
} from '@forepath/identity/backend';
import {
  All,
  Body,
  CanActivate,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';

import { OPENAI_COMPATIBLE_CHAT_ID_HEADER } from '../constants/openai-compatible.constants';
import { OpenAiCompatibleExceptionFilter } from '../filters/openai-compatible-exception.filter';
import { ClientsRepository } from '../repositories/clients.repository';
import { ClientAgentChatsProxyService } from '../services/client-agent-chats-proxy.service';
import {
  OpenAiClientToolTurnsService,
  type ClientToolResultInput,
  type ClientToolTurnHandle,
} from '../services/openai-client-tool-turns.service';
import { isOpenAiCompatibleApiEnabled, OpenAiCompatibleService } from '../services/openai-compatible.service';
import {
  RemoteChatTurnAbortedError,
  type RemoteVisibleChatTurnResult,
} from '../services/remote-agents-session.service';
import { classifyPersistedAgentMessage } from '../utils/agent-response-text.utils';
import {
  type AgentToolActivity,
  AgentToolActivityTracker,
  applyToolEvent,
  collectToolActivity,
  summarizeToolActivity,
} from '../utils/agent-tool-activity.utils';
import { OpenAiApiError, toOpenAiError } from '../utils/openai-compatible-errors';
import {
  OPENAI_CHAT_ID_HEADER,
  OPENAI_TOOL_ACTIVITY_HEADER,
  parseChatCompletionRequest,
  parseConversationCreateRequest,
  parseConversationId,
  parseConversationUpdateRequest,
  parseItemId,
  parseListQuery,
  parseResponsesRequest,
  toItemId,
  toResponseId,
  type ParsedResponsesRequest,
  type ParsedToolResult,
} from '../utils/openai-compatible-request.utils';
import {
  buildChatCompletion,
  buildChatCompletionChunk,
  buildChatCompletionUsageChunk,
  buildConversation,
  buildMcpCallItem,
  buildOutputMessage,
  buildOutputText,
  buildResponseObject,
  type OpenAiMcpCallItem,
  unixSeconds,
} from '../utils/openai-compatible-response.utils';
import { OpenAiSseWriter } from '../utils/openai-compatible-sse';

import { clientToolPrincipal, presentChatCompletion, presentResponse } from './openai-client-tool-responses';

/** Response header carrying the chat session a turn ran in (and request header selecting it). */
const CHAT_ID_RESPONSE_HEADER = OPENAI_COMPATIBLE_CHAT_ID_HEADER;
/** Messages fetched per page while walking a chat session for conversation items. */
const ITEMS_PAGE_SIZE = 200;
/** Upper bound of messages scanned for one items request (very long chats are truncated). */
const ITEMS_MAX_SCAN = 10_000;

/** Disabled via `OPENAI_COMPATIBLE_API_ENABLED=false`: the routes answer 404 (after authentication). */
@Injectable()
export class OpenAiCompatibleEnabledGuard implements CanActivate {
  canActivate(): boolean {
    if (!isOpenAiCompatibleApiEnabled()) {
      throw new NotFoundException('The OpenAI-compatible API is disabled');
    }

    return true;
  }
}

type ResponseOutputItem = ReturnType<typeof buildOutputMessage> | OpenAiMcpCallItem;

type ChatSessionMessage = Awaited<ReturnType<ClientAgentChatsProxyService['listMessages']>>[number];

function toConversationItem(message: ChatSessionMessage) {
  const id = toItemId(message.id);

  if (message.actor === 'user') {
    return {
      type: 'message' as const,
      id,
      status: 'completed' as const,
      role: 'user' as const,
      content: [{ type: 'input_text' as const, text: message.message }],
      created_at: unixSeconds(message.createdAt),
    };
  }

  const outcome = classifyPersistedAgentMessage(message.message);
  const text =
    outcome.kind === 'text' ? outcome.text : outcome.kind === 'error' ? outcome.message : 'Message dropped by filter';

  return {
    type: 'message' as const,
    id,
    status: outcome.kind === 'text' ? ('completed' as const) : ('incomplete' as const),
    role: 'assistant' as const,
    content: [buildOutputText(text)],
    created_at: unixSeconds(message.createdAt),
  };
}

/**
 * OpenAI-compatible API for one agent: point an OpenAI SDK at
 * `<controller>/api/clients/{clientId}/agents/{agentId}/openai/v1`.
 *
 * Authentication is the regular controller authentication (static API key, mTLS, OIDC / SAML / users sessions, PAT
 * and app access tokens; raw `fp_pat_…` PATs are accepted on these routes only). PAT / app tokens need the same
 * domain scopes as the console chat (`agent_chats:*`, `agents:read` for models); workspace membership and the
 * agent-in-workspace check apply exactly like the REST chat routes.
 *
 * Turns run in a visible chat session (primary by default, selectable via `X-Agenstra-Chat-Id`, `chat_id`,
 * `conversation` or `previous_response_id`) with the chat's interactive permissions and message filters.
 */
@Controller('clients/:id/agents/:agentId/openai/v1')
@UseGuards(OpenAiCompatibleEnabledGuard)
@UseFilters(OpenAiCompatibleExceptionFilter)
export class OpenAiCompatibleController {
  constructor(
    private readonly openAi: OpenAiCompatibleService,
    private readonly chatsProxy: ClientAgentChatsProxyService,
    private readonly clientsRepository: ClientsRepository,
    private readonly clientUsersRepository: ClientUsersRepository,
    private readonly clientToolTurns: OpenAiClientToolTurnsService,
  ) {}

  // -------------------------------------------------------------------------------------------------------------------
  // Models
  // -------------------------------------------------------------------------------------------------------------------

  @Get('models')
  @RequireScopes('agents:read')
  async listModels(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Req() req: RequestWithUser,
  ) {
    await this.ensureAccess(id, req);

    return await this.openAi.listModels(id, agentId);
  }

  @Get('models/*model')
  @RequireScopes('agents:read')
  async getModel(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('model') model: string | string[],
    @Req() req: RequestWithUser,
  ) {
    await this.ensureAccess(id, req);

    return await this.openAi.getModel(id, agentId, Array.isArray(model) ? model.join('/') : model);
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Chat Completions
  // -------------------------------------------------------------------------------------------------------------------

  @Post('chat/completions')
  @RequireScopes('agent_chats:write')
  async createChatCompletion(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Body() body: unknown,
    @Headers(OPENAI_CHAT_ID_HEADER) chatIdHeader: string | undefined,
    @Headers(OPENAI_TOOL_ACTIVITY_HEADER) toolActivityHeader: string | undefined,
    @Req() req: RequestWithUser,
    @Res() res: Response,
  ): Promise<void> {
    const request = parseChatCompletionRequest(body, chatIdHeader, toolActivityHeader);

    await this.ensureAccess(id, req);

    if (request.clientTools || request.toolResults.length > 0) {
      const handle = await this.continueOrStartClientToolTurn(id, agentId, req, {
        explicitChatId: request.chatId,
        prompt: request.prompt,
        model: request.model,
        toolResults: request.toolResults,
        clientTools: request.clientTools,
        toolChoice: request.toolChoice,
        parallelToolCalls: request.parallelToolCalls,
        legacyFunctions: request.legacyFunctions,
        toolActivity: request.toolActivity,
      });

      if (handle) {
        await presentChatCompletion(res, {
          handle,
          chatId: handle.chatId,
          model: request.model,
          stream: request.stream,
          includeUsage: request.includeUsage,
          toolActivity: request.toolActivity,
          legacyFunctions: request.legacyFunctions,
        });

        return;
      }
    }

    const model = await this.openAi.resolveModel(id, agentId, request.model);
    const chatId = await this.openAi.resolveChatId(id, agentId, request.chatId);
    const completionId = `chatcmpl-${randomUUID().replace(/-/g, '')}`;
    const created = unixSeconds();
    const abort = this.abortOnClientClose(res);
    const turn = {
      clientId: id,
      agentId,
      chatId,
      prompt: request.prompt,
      model,
      userId: getUserFromRequest(req).userId ?? null,
      signal: abort.signal,
    };
    const summary = (activities: AgentToolActivity[]) =>
      activities.length > 0 ? activities.map(summarizeToolActivity).join('\n') : undefined;

    if (!request.stream) {
      const result = await this.runTurnOrIgnoreAbort(() => this.openAi.runTurn(turn));

      if (!result) {
        return;
      }

      res.setHeader(CHAT_ID_RESPONSE_HEADER, chatId);
      res.status(HttpStatus.OK).json(
        buildChatCompletion({
          id: completionId,
          created,
          model: request.model,
          text: result.text,
          finishReason: result.finishReason,
          usage: result.usage,
          // Tool activity of the final, filtered agent response.
          reasoningContent: request.toolActivity ? summary(collectToolActivity(result.response)) : undefined,
        }),
      );

      return;
    }

    const liveDeltas = await this.openAi.canStreamDeltas(id, agentId);
    const sse = new OpenAiSseWriter(res);
    const chunk = (
      delta: { role?: 'assistant'; content?: string; reasoning_content?: string },
      finishReason: 'stop' | 'content_filter' | null,
    ) =>
      buildChatCompletionChunk({
        id: completionId,
        created,
        model: request.model,
        delta,
        finishReason,
        includeUsage: request.includeUsage,
      });
    const tracker = new AgentToolActivityTracker();

    sse.start({ [CHAT_ID_RESPONSE_HEADER]: chatId });
    sse.send(chunk({ role: 'assistant', content: '' }, null));

    try {
      let streamed = false;
      let toolsStreamed = false;
      const result = await this.runTurnOrIgnoreAbort(() =>
        this.openAi.runTurn({
          ...turn,
          onDeltaText: liveDeltas
            ? (delta) => {
                streamed = true;
                sse.send(chunk({ content: delta }, null));
              }
            : undefined,
          // Live tool activity follows the same gate as live text (emitted before outgoing filters run).
          onToolEvent:
            liveDeltas && request.toolActivity
              ? (event) => {
                  const entry = applyToolEvent(tracker, event);

                  if (entry && entry.status !== 'in_progress') {
                    toolsStreamed = true;
                    sse.send(chunk({ reasoning_content: `${summarizeToolActivity(entry)}\n` }, null));
                  }
                }
              : undefined,
        }),
      );

      if (!result) {
        sse.end();

        return;
      }

      if (request.toolActivity && !toolsStreamed) {
        const reasoning = summary(collectToolActivity(result.response));

        if (reasoning) {
          sse.send(chunk({ reasoning_content: `${reasoning}\n` }, null));
        }
      }

      // Without live deltas (or when the stream had none) the filtered final answer is sent as one chunk.
      if (!streamed && result.text) {
        sse.send(chunk({ content: result.text }, null));
      }

      sse.send(chunk({}, result.finishReason));

      if (request.includeUsage) {
        sse.send(
          buildChatCompletionUsageChunk({ id: completionId, created, model: request.model, usage: result.usage }),
        );
      }

      sse.send('[DONE]');
    } catch (error) {
      sse.send(toOpenAiError(error).body);
    } finally {
      sse.end();
    }
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Responses
  // -------------------------------------------------------------------------------------------------------------------

  @Post('responses')
  @RequireScopes('agent_chats:write')
  async createResponse(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Body() body: unknown,
    @Headers(OPENAI_CHAT_ID_HEADER) chatIdHeader: string | undefined,
    @Headers(OPENAI_TOOL_ACTIVITY_HEADER) toolActivityHeader: string | undefined,
    @Req() req: RequestWithUser,
    @Res() res: Response,
  ): Promise<void> {
    const request = parseResponsesRequest(body, chatIdHeader, toolActivityHeader);

    await this.ensureAccess(id, req);

    if (request.clientTools || request.toolResults.length > 0) {
      const handle = await this.continueOrStartClientToolTurn(id, agentId, req, {
        explicitChatId: request.chatId,
        prompt: request.prompt,
        model: request.model,
        toolResults: request.toolResults,
        clientTools: request.clientTools,
        toolChoice: request.toolChoice,
        parallelToolCalls: request.parallelToolCalls,
        legacyFunctions: false,
        toolActivity: request.toolActivity,
        previousResponseId: request.previousResponseId,
      });

      if (handle) {
        await presentResponse(res, { handle, chatId: handle.chatId, request });

        return;
      }
    }

    const model = await this.openAi.resolveModel(id, agentId, request.model);
    const chatId = await this.resolveResponsesChatId(id, agentId, request);
    const responseId = toResponseId(chatId, randomBytes(12).toString('hex'));
    const messageId = `msg_${randomBytes(16).toString('hex')}`;
    const createdAt = unixSeconds();
    const abort = this.abortOnClientClose(res);
    const turn = {
      clientId: id,
      agentId,
      chatId,
      prompt: request.prompt,
      model,
      userId: getUserFromRequest(req).userId ?? null,
      signal: abort.signal,
    };
    const responseObject = (
      status: 'in_progress' | 'completed' | 'incomplete' | 'failed',
      output: ResponseOutputItem[],
      result?: RemoteVisibleChatTurnResult,
      error?: { code: string; message: string },
    ) =>
      buildResponseObject({
        id: responseId,
        createdAt,
        model: request.model,
        status,
        chatId,
        conversationRequested: request.conversationRequested,
        previousResponseId: request.previousResponseId,
        instructions: request.instructions,
        metadata: request.metadata,
        output,
        usage: result?.usage,
        error,
      });
    const finalStatus = (result: RemoteVisibleChatTurnResult) =>
      result.finishReason === 'content_filter' ? ('incomplete' as const) : ('completed' as const);

    if (!request.stream) {
      const result = await this.runTurnOrIgnoreAbort(() => this.openAi.runTurn(turn));

      if (!result) {
        return;
      }

      const status = finalStatus(result);
      // Tool activity of the final, filtered agent response, before the answer (call order).
      const tools = request.toolActivity ? collectToolActivity(result.response).map(buildMcpCallItem) : [];

      res.setHeader(CHAT_ID_RESPONSE_HEADER, chatId);
      res
        .status(HttpStatus.OK)
        .json(
          responseObject(status, [...tools, buildOutputMessage({ id: messageId, text: result.text, status })], result),
        );

      return;
    }

    const liveDeltas = await this.openAi.canStreamDeltas(id, agentId);
    const sse = new OpenAiSseWriter(res);
    let sequence = 0;
    const emit = (type: string, payload: Record<string, unknown>) =>
      sse.send({ type, sequence_number: sequence++, ...payload }, type);
    // Output items in the order they were added (`output_index`); tool items and the answer may interleave.
    const output: ResponseOutputItem[] = [];
    const toolIndex = new Map<string, number>();
    const tracker = new AgentToolActivityTracker();
    let messageIndex = -1;
    let streamedText = '';
    const textEventBase = () => ({ item_id: messageId, output_index: messageIndex, content_index: 0 });
    const startMessage = () => {
      if (messageIndex >= 0) {
        return;
      }

      messageIndex = output.length;
      const item = buildOutputMessage({ id: messageId, text: '', status: 'in_progress' });

      output.push(item);
      emit('response.output_item.added', { output_index: messageIndex, item });
      emit('response.content_part.added', { ...textEventBase(), part: buildOutputText('') });
    };
    const addTool = (activity: AgentToolActivity) => {
      if (toolIndex.has(activity.id)) {
        return;
      }

      const index = output.length;
      const item = buildMcpCallItem({ ...activity, status: 'in_progress', output: null });

      output.push(item);
      toolIndex.set(activity.id, index);
      emit('response.output_item.added', { output_index: index, item });
      emit('response.mcp_call.in_progress', { item_id: item.id, output_index: index });
    };
    const completeTool = (activity: AgentToolActivity) => {
      addTool(activity);
      const index = toolIndex.get(activity.id) as number;
      const item = buildMcpCallItem(
        activity.status === 'in_progress' ? { ...activity, status: 'completed' } : activity,
      );

      if ((output[index] as OpenAiMcpCallItem).status !== 'in_progress') {
        return;
      }

      output[index] = item;
      emit('response.mcp_call_arguments.done', { item_id: item.id, output_index: index, arguments: item.arguments });
      emit(item.status === 'failed' ? 'response.mcp_call.failed' : 'response.mcp_call.completed', {
        item_id: item.id,
        output_index: index,
      });
      emit('response.output_item.done', { output_index: index, item });
    };

    sse.start({ [CHAT_ID_RESPONSE_HEADER]: chatId });
    emit('response.created', { response: responseObject('in_progress', []) });
    emit('response.in_progress', { response: responseObject('in_progress', []) });

    try {
      let streamed = false;
      const result = await this.runTurnOrIgnoreAbort(() =>
        this.openAi.runTurn({
          ...turn,
          onDeltaText: liveDeltas
            ? (delta) => {
                startMessage();
                streamed = true;
                streamedText += delta;
                emit('response.output_text.delta', { ...textEventBase(), delta, logprobs: [] });
              }
            : undefined,
          // Live tool activity follows the same gate as live text (emitted before outgoing filters run).
          onToolEvent:
            liveDeltas && request.toolActivity
              ? (event) => {
                  const entry = applyToolEvent(tracker, event);

                  if (!entry) {
                    return;
                  }

                  if (entry.status === 'in_progress') {
                    addTool(entry);
                  } else {
                    completeTool(entry);
                  }
                }
              : undefined,
        }),
      );

      if (!result) {
        sse.end();

        return;
      }

      if (request.toolActivity) {
        // Filtered final tool activity: everything when not streamed live, otherwise closes calls still open.
        const finalTools = new Map(collectToolActivity(result.response).map((activity) => [activity.id, activity]));

        if (toolIndex.size === 0) {
          finalTools.forEach((activity) => completeTool(activity));
        } else {
          tracker.list().forEach((activity) => completeTool(finalTools.get(activity.id) ?? activity));
        }
      }

      startMessage();
      // The answer as streamed (live deltas) or the filtered final text.
      const text = streamed ? streamedText : result.text;

      if (!streamed && text) {
        emit('response.output_text.delta', { ...textEventBase(), delta: text, logprobs: [] });
      }

      const status = finalStatus(result);
      const message = buildOutputMessage({ id: messageId, text, status });

      output[messageIndex] = message;
      emit('response.output_text.done', { ...textEventBase(), text, logprobs: [] });
      emit('response.content_part.done', { ...textEventBase(), part: buildOutputText(text) });
      emit('response.output_item.done', { output_index: messageIndex, item: message });
      emit(status === 'completed' ? 'response.completed' : 'response.incomplete', {
        response: responseObject(status, output, result),
      });
    } catch (error) {
      const { body: errorBody } = toOpenAiError(error);
      const code = errorBody.error.code ?? errorBody.error.type;

      emit('error', { code, message: errorBody.error.message, param: errorBody.error.param });
      emit('response.failed', {
        response: responseObject('failed', output, undefined, { code, message: errorBody.error.message }),
      });
    } finally {
      sse.end();
    }
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Conversations (chat sessions)
  // -------------------------------------------------------------------------------------------------------------------

  @Post('conversations')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('agent_chats:write')
  async createConversation(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Body() body: unknown,
    @Req() req: RequestWithUser,
  ) {
    const request = parseConversationCreateRequest(body);

    await this.ensureAccess(id, req);

    return buildConversation(await this.chatsProxy.create(id, agentId, { title: request.title }));
  }

  @Get('conversations/:conversationId')
  @RequireScopes('agent_chats:read')
  async getConversation(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('conversationId') conversationId: string,
    @Req() req: RequestWithUser,
  ) {
    const chatId = this.parseConversation(conversationId);

    await this.ensureAccess(id, req);

    return buildConversation(await this.getChatSession(id, agentId, chatId));
  }

  @Post('conversations/:conversationId')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('agent_chats:write')
  async updateConversation(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('conversationId') conversationId: string,
    @Body() body: unknown,
    @Req() req: RequestWithUser,
  ) {
    const chatId = this.parseConversation(conversationId);
    const request = parseConversationUpdateRequest(body);

    await this.ensureAccess(id, req);

    if (!request.title) {
      return buildConversation(await this.getChatSession(id, agentId, chatId));
    }

    await this.getChatSession(id, agentId, chatId);

    return buildConversation(await this.chatsProxy.update(id, agentId, chatId, { title: request.title }));
  }

  @Delete('conversations/:conversationId')
  @RequireScopes('agent_chats:write')
  async deleteConversation(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('conversationId') conversationId: string,
    @Req() req: RequestWithUser,
  ) {
    const chatId = this.parseConversation(conversationId);

    await this.ensureAccess(id, req);
    await this.getChatSession(id, agentId, chatId);
    await this.chatsProxy.delete(id, agentId, chatId);

    return { id: conversationId, object: 'conversation.deleted' as const, deleted: true };
  }

  @Get('conversations/:conversationId/items')
  @RequireScopes('agent_chats:read')
  async listConversationItems(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('conversationId') conversationId: string,
    @Query() query: Record<string, unknown>,
    @Req() req: RequestWithUser,
  ) {
    const chatId = this.parseConversation(conversationId);
    const { limit, order, after } = parseListQuery(query ?? {});

    await this.ensureAccess(id, req);
    await this.getChatSession(id, agentId, chatId);

    const messages = await this.loadMessages(id, agentId, chatId);
    const ordered = order === 'asc' ? messages : [...messages].reverse();
    let start = 0;

    if (after) {
      const index = ordered.findIndex((message) => message.id === after);

      if (index < 0) {
        throw OpenAiApiError.invalidRequest('after does not reference an item of this conversation', 'after');
      }

      start = index + 1;
    }

    const page = ordered.slice(start, start + limit).map(toConversationItem);

    return {
      object: 'list' as const,
      data: page,
      first_id: page[0]?.id ?? null,
      last_id: page[page.length - 1]?.id ?? null,
      has_more: start + limit < ordered.length,
    };
  }

  @Get('conversations/:conversationId/items/:itemId')
  @RequireScopes('agent_chats:read')
  async getConversationItem(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
    @Param('conversationId') conversationId: string,
    @Param('itemId') itemId: string,
    @Req() req: RequestWithUser,
  ) {
    const chatId = this.parseConversation(conversationId);
    const messageId = parseItemId(itemId);

    if (!messageId) {
      throw OpenAiApiError.notFound(`Item with id '${itemId}' not found.`);
    }

    await this.ensureAccess(id, req);
    await this.getChatSession(id, agentId, chatId);
    const message = (await this.loadMessages(id, agentId, chatId)).find((entry) => entry.id === messageId);

    if (!message) {
      throw OpenAiApiError.notFound(`Item with id '${itemId}' not found.`);
    }

    return toConversationItem(message);
  }

  /**
   * Everything else under the OpenAI base path (embeddings, images, audio, files, stored responses, …) has no
   * Agenstra equivalent. Answers with an OpenAI-style error instead of the router's generic 404.
   */
  @All('*path')
  @RequireScopes('agents:read')
  unsupported(): never {
    throw OpenAiApiError.notFound(
      'This OpenAI endpoint is not supported by Agenstra. Supported: models, chat/completions, responses, conversations.',
      'unsupported_endpoint',
    );
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Client tool turns: continue a paused turn with the client's tool results, or start a turn that offers the client's
   * function tools. Returns undefined when the request is an ordinary turn (no tools offered, results unmatched and a
   * new user message present): the regular path handles it.
   */
  private async continueOrStartClientToolTurn(
    clientId: string,
    agentId: string,
    req: RequestWithUser,
    request: {
      explicitChatId?: string;
      prompt: string;
      model: string;
      toolResults: ParsedToolResult[];
      clientTools?: ClientToolDefinition[];
      toolChoice: ClientToolChoice;
      parallelToolCalls: boolean;
      legacyFunctions: boolean;
      toolActivity: boolean;
      previousResponseId?: string | null;
    },
  ): Promise<ClientToolTurnHandle | undefined> {
    const principal = clientToolPrincipal(req);

    if (request.toolResults.length > 0) {
      try {
        const results = await this.resolveToolResults(clientId, agentId, principal, request);

        return await this.clientToolTurns.resume(
          { principal, clientId, agentId, ...(request.explicitChatId ? { chatId: request.explicitChatId } : {}) },
          results,
        );
      } catch (error) {
        // Replayed results of an earlier turn next to a new user message: start a new turn (harness histories).
        const unmatched = error instanceof OpenAiApiError && error.errorCode === 'tool_call_not_found';

        if (!unmatched || !request.prompt) {
          throw error;
        }
      }
    }

    if (!request.clientTools || !request.prompt) {
      return undefined;
    }

    const model = await this.openAi.resolveModel(clientId, agentId, request.model);
    const chatId = await this.resolveChatForClientTools(clientId, agentId, request);

    return this.clientToolTurns.start({
      binding: { principal, clientId, agentId, chatId },
      turn: {
        clientId,
        agentId,
        chatId,
        prompt: request.prompt,
        model,
        userId: getUserFromRequest(req).userId ?? null,
      },
      clientTools: { tools: request.clientTools, choice: request.toolChoice, parallel: request.parallelToolCalls },
      liveDeltas: await this.openAi.canStreamDeltas(clientId, agentId),
      toolActivity: request.toolActivity,
      legacyFunctions: request.legacyFunctions,
    });
  }

  private async resolveChatForClientTools(
    clientId: string,
    agentId: string,
    request: { explicitChatId?: string; previousResponseId?: string | null },
  ): Promise<string> {
    try {
      return await this.openAi.resolveChatId(clientId, agentId, request.explicitChatId);
    } catch (error) {
      if (
        error instanceof OpenAiApiError &&
        error.errorCode === 'conversation_not_found' &&
        request.previousResponseId
      ) {
        throw OpenAiApiError.notFound(
          `Previous response with id '${request.previousResponseId}' not found.`,
          'previous_response_not_found',
          'previous_response_id',
        );
      }

      throw error;
    }
  }

  /** Call ids of the results; legacy `function` messages are matched by name within the chat's pending turn. */
  private async resolveToolResults(
    clientId: string,
    agentId: string,
    principal: string,
    request: { explicitChatId?: string; toolResults: ParsedToolResult[] },
  ): Promise<ClientToolResultInput[]> {
    const results: ClientToolResultInput[] = [];
    let legacyChatId: string | undefined;

    for (const result of request.toolResults) {
      if (result.callId) {
        results.push({ callId: result.callId, output: result.output });
        continue;
      }

      legacyChatId ??= await this.openAi.resolveChatId(clientId, agentId, request.explicitChatId);
      const callId = await this.clientToolTurns.resolveLegacyCallId(
        { principal, clientId, agentId, chatId: legacyChatId },
        result.name ?? '',
      );

      if (!callId) {
        throw OpenAiApiError.notFound(
          'No pending tool call matches the tool results (unknown, already answered or expired).',
          'tool_call_not_found',
          'tool_call_id',
        );
      }

      results.push({ callId, output: result.output });
    }

    return results;
  }

  private async ensureAccess(clientId: string, req: RequestWithUser): Promise<void> {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);
  }

  private parseConversation(conversationId: string): string {
    const chatId = parseConversationId(conversationId);

    if (!chatId) {
      throw OpenAiApiError.notFound(`Conversation with id '${conversationId}' not found.`, 'conversation_not_found');
    }

    return chatId;
  }

  private async getChatSession(clientId: string, agentId: string, chatId: string) {
    try {
      return await this.chatsProxy.get(clientId, agentId, chatId);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw OpenAiApiError.notFound('Conversation not found.', 'conversation_not_found');
      }

      throw error;
    }
  }

  private async resolveResponsesChatId(clientId: string, agentId: string, request: ParsedResponsesRequest) {
    try {
      return await this.openAi.resolveChatId(clientId, agentId, request.chatId);
    } catch (error) {
      if (
        error instanceof OpenAiApiError &&
        error.errorCode === 'conversation_not_found' &&
        request.previousResponseId
      ) {
        throw OpenAiApiError.notFound(
          `Previous response with id '${request.previousResponseId}' not found.`,
          'previous_response_not_found',
          'previous_response_id',
        );
      }

      throw error;
    }
  }

  private async loadMessages(clientId: string, agentId: string, chatId: string): Promise<ChatSessionMessage[]> {
    const messages: ChatSessionMessage[] = [];

    for (let offset = 0; offset < ITEMS_MAX_SCAN; offset += ITEMS_PAGE_SIZE) {
      const page = await this.chatsProxy.listMessages(clientId, agentId, chatId, ITEMS_PAGE_SIZE, offset);

      messages.push(...page);

      if (page.length < ITEMS_PAGE_SIZE) {
        break;
      }
    }

    return messages;
  }

  /** Aborts the wait for the agent when the HTTP client goes away; the turn itself completes in the chat. */
  private abortOnClientClose(res: Response): AbortController {
    const controller = new AbortController();

    res.on('close', () => {
      if (!res.writableEnded) {
        controller.abort();
      }
    });

    return controller;
  }

  private async runTurnOrIgnoreAbort(
    run: () => Promise<RemoteVisibleChatTurnResult>,
  ): Promise<RemoteVisibleChatTurnResult | undefined> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof RemoteChatTurnAbortedError) {
        return undefined;
      }

      throw error;
    }
  }
}
