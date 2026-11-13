import { randomBytes, randomUUID } from 'node:crypto';

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
import { isOpenAiCompatibleApiEnabled, OpenAiCompatibleService } from '../services/openai-compatible.service';
import {
  RemoteChatTurnAbortedError,
  type RemoteVisibleChatTurnResult,
} from '../services/remote-agents-session.service';
import { classifyPersistedAgentMessage } from '../utils/agent-response-text.utils';
import { OpenAiApiError, toOpenAiError } from '../utils/openai-compatible-errors';
import {
  OPENAI_CHAT_ID_HEADER,
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
} from '../utils/openai-compatible-request.utils';
import {
  buildChatCompletion,
  buildChatCompletionChunk,
  buildChatCompletionUsageChunk,
  buildConversation,
  buildOutputMessage,
  buildOutputText,
  buildResponseObject,
  unixSeconds,
} from '../utils/openai-compatible-response.utils';
import { OpenAiSseWriter } from '../utils/openai-compatible-sse';

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
    @Req() req: RequestWithUser,
    @Res() res: Response,
  ): Promise<void> {
    const request = parseChatCompletionRequest(body, chatIdHeader);

    await this.ensureAccess(id, req);
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
        }),
      );

      return;
    }

    const liveDeltas = await this.openAi.canStreamDeltas(id, agentId);
    const sse = new OpenAiSseWriter(res);
    const chunk = (delta: { role?: 'assistant'; content?: string }, finishReason: 'stop' | 'content_filter' | null) =>
      buildChatCompletionChunk({
        id: completionId,
        created,
        model: request.model,
        delta,
        finishReason,
        includeUsage: request.includeUsage,
      });

    sse.start({ [CHAT_ID_RESPONSE_HEADER]: chatId });
    sse.send(chunk({ role: 'assistant', content: '' }, null));

    try {
      let streamed = false;
      const result = await this.runTurnOrIgnoreAbort(() =>
        this.openAi.runTurn({
          ...turn,
          onDeltaText: liveDeltas
            ? (delta) => {
                streamed = true;
                sse.send(chunk({ content: delta }, null));
              }
            : undefined,
        }),
      );

      if (!result) {
        sse.end();

        return;
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
    @Req() req: RequestWithUser,
    @Res() res: Response,
  ): Promise<void> {
    const request = parseResponsesRequest(body, chatIdHeader);

    await this.ensureAccess(id, req);
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
        output: result
          ? [
              buildOutputMessage({
                id: messageId,
                text: result.text,
                status: status === 'completed' ? 'completed' : 'incomplete',
              }),
            ]
          : [],
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

      res.setHeader(CHAT_ID_RESPONSE_HEADER, chatId);
      res.status(HttpStatus.OK).json(responseObject(finalStatus(result), result));

      return;
    }

    const liveDeltas = await this.openAi.canStreamDeltas(id, agentId);
    const sse = new OpenAiSseWriter(res);
    let sequence = 0;
    const emit = (type: string, payload: Record<string, unknown>) =>
      sse.send({ type, sequence_number: sequence++, ...payload }, type);
    const textEventBase = { item_id: messageId, output_index: 0, content_index: 0 };
    let outputStarted = false;
    const startOutput = () => {
      if (outputStarted) {
        return;
      }

      outputStarted = true;
      emit('response.output_item.added', {
        output_index: 0,
        item: buildOutputMessage({ id: messageId, text: '', status: 'in_progress' }),
      });
      emit('response.content_part.added', { ...textEventBase, part: buildOutputText('') });
    };

    sse.start({ [CHAT_ID_RESPONSE_HEADER]: chatId });
    emit('response.created', { response: responseObject('in_progress') });
    emit('response.in_progress', { response: responseObject('in_progress') });

    try {
      let streamed = false;
      const result = await this.runTurnOrIgnoreAbort(() =>
        this.openAi.runTurn({
          ...turn,
          onDeltaText: liveDeltas
            ? (delta) => {
                startOutput();
                streamed = true;
                emit('response.output_text.delta', { ...textEventBase, delta, logprobs: [] });
              }
            : undefined,
        }),
      );

      if (!result) {
        sse.end();

        return;
      }

      startOutput();

      if (!streamed && result.text) {
        emit('response.output_text.delta', { ...textEventBase, delta: result.text, logprobs: [] });
      }

      const status = finalStatus(result);

      emit('response.output_text.done', { ...textEventBase, text: result.text, logprobs: [] });
      emit('response.content_part.done', { ...textEventBase, part: buildOutputText(result.text) });
      emit('response.output_item.done', {
        output_index: 0,
        item: buildOutputMessage({ id: messageId, text: result.text, status }),
      });
      emit(status === 'completed' ? 'response.completed' : 'response.incomplete', {
        response: responseObject(status, result),
      });
    } catch (error) {
      const { body: errorBody } = toOpenAiError(error);
      const code = errorBody.error.code ?? errorBody.error.type;

      emit('error', { code, message: errorBody.error.message, param: errorBody.error.param });
      emit('response.failed', {
        response: responseObject('failed', undefined, { code, message: errorBody.error.message }),
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
