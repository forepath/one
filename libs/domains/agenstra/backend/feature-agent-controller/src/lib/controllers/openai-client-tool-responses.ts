import { randomBytes } from 'node:crypto';

import type { RequestWithUser } from '@forepath/identity/backend';
import { HttpStatus } from '@nestjs/common';
import type { Response } from 'express';

import type { ClientToolTurnHandle, ClientToolTurnUpdate } from '../services/openai-client-tool-turns.service';
import {
  type AgentToolActivity,
  AgentToolActivityTracker,
  applyToolEvent,
  collectToolActivity,
  summarizeToolActivity,
} from '../utils/agent-tool-activity.utils';
import { toResponseId, type ParsedResponsesRequest } from '../utils/openai-compatible-request.utils';
import {
  buildChatCompletion,
  buildChatCompletionChunk,
  buildChatCompletionUsageChunk,
  buildFunctionCallItem,
  buildMcpCallItem,
  buildOutputMessage,
  buildOutputText,
  buildResponseObject,
  type OpenAiClientToolCall,
  type OpenAiFunctionCallItem,
  type OpenAiMcpCallItem,
  unixSeconds,
} from '../utils/openai-compatible-response.utils';
import { OpenAiSseWriter } from '../utils/openai-compatible-sse';

/** Response header carrying the chat session a turn ran in. */
export const CHAT_ID_RESPONSE_HEADER = 'X-Agenstra-Chat-Id';

/**
 * Principal and credential lineage allowed to continue a client tool turn: the same static credential (API key / mTLS
 * principal), or the same user through the same personal access token / app session / interactive session.
 */
export function clientToolPrincipal(req: RequestWithUser): string {
  const request = req as RequestWithUser & {
    apiKeyAuthenticated?: boolean;
    user?: { id?: string; patId?: string; appSessionId?: string };
  };
  const user = request.user;

  if (request.apiKeyAuthenticated) {
    return `static:${user?.id ?? 'static'}`;
  }

  const lineage = user?.patId ? `pat:${user.patId}` : user?.appSessionId ? `app:${user.appSessionId}` : 'session';

  return `user:${user?.id ?? 'unknown'}|${lineage}`;
}

/** Reads one request's updates; `undefined` when the client went away. */
async function* updates(handle: ClientToolTurnHandle): AsyncGenerator<ClientToolTurnUpdate> {
  for (;;) {
    const update = await handle.next();

    if (!update) {
      return;
    }

    yield update;

    if (update.type === 'tool_calls' || update.type === 'final' || update.type === 'error') {
      return;
    }
  }
}

function summary(activities: AgentToolActivity[]): string | undefined {
  return activities.length > 0 ? activities.map(summarizeToolActivity).join('\n') : undefined;
}

function closeOnDisconnect(res: Response, handle: ClientToolTurnHandle): void {
  res.on('close', () => {
    if (!res.writableEnded) {
      handle.close();
    }
  });
}

export interface ChatCompletionPresentation {
  handle: ClientToolTurnHandle;
  chatId: string;
  model: string;
  stream: boolean;
  includeUsage: boolean;
  toolActivity: boolean;
  legacyFunctions: boolean;
}

/** One Chat Completions request of a client tool turn: until the next tool calls or the final answer. */
export async function presentChatCompletion(res: Response, options: ChatCompletionPresentation): Promise<void> {
  const { handle } = options;
  const completionId = `chatcmpl-${randomBytes(16).toString('hex')}`;
  const created = unixSeconds();
  const tracker = new AgentToolActivityTracker();
  const toolCallsFinish = options.legacyFunctions ? ('function_call' as const) : ('tool_calls' as const);

  closeOnDisconnect(res, handle);

  if (!options.stream) {
    let text = '';

    for await (const update of updates(handle)) {
      if (update.type === 'delta') {
        text += update.delta;
      } else if (update.type === 'tool_event') {
        applyToolEvent(tracker, update.event);
      } else if (update.type === 'error') {
        res.status(update.status).json(update.body);

        return;
      } else {
        const final = update.type === 'final' ? update.result : undefined;
        const activity = final && tracker.list().length === 0 ? collectToolActivity(final.response) : tracker.list();

        res.setHeader(CHAT_ID_RESPONSE_HEADER, options.chatId);
        res.status(HttpStatus.OK).json(
          buildChatCompletion({
            id: completionId,
            created,
            model: options.model,
            text: final ? final.text : text,
            finishReason: final ? final.finishReason : toolCallsFinish,
            usage: final?.usage,
            reasoningContent: options.toolActivity ? summary(activity) : undefined,
            toolCalls: update.type === 'tool_calls' ? update.calls : undefined,
            legacyFunctions: options.legacyFunctions,
          }),
        );

        return;
      }
    }

    return;
  }

  const sse = new OpenAiSseWriter(res);
  const chunk = (
    delta: Parameters<typeof buildChatCompletionChunk>[0]['delta'],
    finishReason: Parameters<typeof buildChatCompletionChunk>[0]['finishReason'],
  ) =>
    buildChatCompletionChunk({
      id: completionId,
      created,
      model: options.model,
      delta,
      finishReason,
      includeUsage: options.includeUsage,
    });
  let streamed = false;
  let toolsStreamed = false;

  sse.start({ [CHAT_ID_RESPONSE_HEADER]: options.chatId });
  sse.send(chunk({ role: 'assistant', content: '' }, null));

  try {
    for await (const update of updates(handle)) {
      if (update.type === 'delta') {
        streamed = true;
        sse.send(chunk({ content: update.delta }, null));
      } else if (update.type === 'tool_event') {
        const entry = applyToolEvent(tracker, update.event);

        if (options.toolActivity && entry && entry.status !== 'in_progress') {
          toolsStreamed = true;
          sse.send(chunk({ reasoning_content: `${summarizeToolActivity(entry)}\n` }, null));
        }
      } else if (update.type === 'error') {
        sse.send(update.body);

        return;
      } else if (update.type === 'tool_calls') {
        sendToolCallChunks(update.calls, options.legacyFunctions, (delta) => sse.send(chunk(delta, null)));
        sse.send(chunk({}, toolCallsFinish));

        if (options.includeUsage) {
          sse.send(buildChatCompletionUsageChunk({ id: completionId, created, model: options.model }));
        }

        sse.send('[DONE]');

        return;
      } else {
        const final = update.result;

        if (options.toolActivity && !toolsStreamed) {
          const reasoning = summary(collectToolActivity(final.response));

          if (reasoning) {
            sse.send(chunk({ reasoning_content: `${reasoning}\n` }, null));
          }
        }

        if (!streamed && final.text) {
          sse.send(chunk({ content: final.text }, null));
        }

        sse.send(chunk({}, final.finishReason));

        if (options.includeUsage) {
          sse.send(
            buildChatCompletionUsageChunk({ id: completionId, created, model: options.model, usage: final.usage }),
          );
        }

        sse.send('[DONE]');

        return;
      }
    }
  } finally {
    sse.end();
  }
}

/** OpenAI streams a tool call as a header chunk (id, name) followed by argument chunks. */
function sendToolCallChunks(
  calls: OpenAiClientToolCall[],
  legacyFunctions: boolean,
  send: (delta: Parameters<typeof buildChatCompletionChunk>[0]['delta']) => void,
): void {
  if (legacyFunctions) {
    const [call] = calls;

    send({ function_call: { name: call.name, arguments: '' } });
    send({ function_call: { arguments: call.arguments } });

    return;
  }

  calls.forEach((call, index) => {
    send({ tool_calls: [{ index, id: call.callId, type: 'function', function: { name: call.name, arguments: '' } }] });
    send({ tool_calls: [{ index, function: { arguments: call.arguments } }] });
  });
}

type ResponseOutputItem = ReturnType<typeof buildOutputMessage> | OpenAiMcpCallItem | OpenAiFunctionCallItem;

export interface ResponsePresentation {
  handle: ClientToolTurnHandle;
  chatId: string;
  request: ParsedResponsesRequest;
}

/** One Responses request of a client tool turn: `function_call` items, or the final answer. */
export async function presentResponse(res: Response, options: ResponsePresentation): Promise<void> {
  const { handle, request } = options;
  const responseId = toResponseId(options.chatId, randomBytes(12).toString('hex'));
  const messageId = `msg_${randomBytes(16).toString('hex')}`;
  const createdAt = unixSeconds();
  const tracker = new AgentToolActivityTracker();
  const responseObject = (
    status: 'in_progress' | 'completed' | 'incomplete' | 'failed',
    output: ResponseOutputItem[],
    usage?: Parameters<typeof buildResponseObject>[0]['usage'],
    error?: { code: string; message: string },
  ) =>
    buildResponseObject({
      id: responseId,
      createdAt,
      model: request.model,
      status,
      chatId: options.chatId,
      conversationRequested: request.conversationRequested,
      previousResponseId: request.previousResponseId,
      instructions: request.instructions,
      metadata: request.metadata,
      output,
      usage,
      error,
    });

  closeOnDisconnect(res, handle);

  if (!request.stream) {
    let text = '';

    for await (const update of updates(handle)) {
      if (update.type === 'delta') {
        text += update.delta;
      } else if (update.type === 'tool_event') {
        applyToolEvent(tracker, update.event);
      } else if (update.type === 'error') {
        res.status(update.status).json(update.body);

        return;
      } else {
        const final = update.type === 'final' ? update.result : undefined;
        const activity = final && tracker.list().length === 0 ? collectToolActivity(final.response) : tracker.list();
        const tools = request.toolActivity ? activity.map(buildMcpCallItem) : [];
        const status = final?.finishReason === 'content_filter' ? 'incomplete' : 'completed';
        const message = final ? final.text : text;
        const output: ResponseOutputItem[] = [
          ...tools,
          ...(message ? [buildOutputMessage({ id: messageId, text: message, status })] : []),
          ...(update.type === 'tool_calls' ? update.calls.map(buildFunctionCallItem) : []),
        ];

        res.setHeader(CHAT_ID_RESPONSE_HEADER, options.chatId);
        res.status(HttpStatus.OK).json(responseObject(status, output, final?.usage));

        return;
      }
    }

    return;
  }

  const sse = new OpenAiSseWriter(res);
  let sequence = 0;
  const emit = (type: string, payload: Record<string, unknown>) =>
    sse.send({ type, sequence_number: sequence++, ...payload }, type);
  const output: ResponseOutputItem[] = [];
  const toolIndex = new Map<string, number>();
  let messageIndex = -1;
  let streamedText = '';
  const textBase = () => ({ item_id: messageId, output_index: messageIndex, content_index: 0 });
  const startMessage = () => {
    if (messageIndex >= 0) {
      return;
    }

    messageIndex = output.length;
    const item = buildOutputMessage({ id: messageId, text: '', status: 'in_progress' });

    output.push(item);
    emit('response.output_item.added', { output_index: messageIndex, item });
    emit('response.content_part.added', { ...textBase(), part: buildOutputText('') });
  };
  const finishMessage = (text: string, status: 'completed' | 'incomplete') => {
    if (messageIndex < 0) {
      return;
    }

    const item = buildOutputMessage({ id: messageId, text, status });

    output[messageIndex] = item;
    emit('response.output_text.done', { ...textBase(), text, logprobs: [] });
    emit('response.content_part.done', { ...textBase(), part: buildOutputText(text) });
    emit('response.output_item.done', { output_index: messageIndex, item });
  };
  const toolItem = (activity: AgentToolActivity) => {
    if (!toolIndex.has(activity.id)) {
      const index = output.length;
      const item = buildMcpCallItem({ ...activity, status: 'in_progress', output: null });

      output.push(item);
      toolIndex.set(activity.id, index);
      emit('response.output_item.added', { output_index: index, item });
      emit('response.mcp_call.in_progress', { item_id: item.id, output_index: index });
    }

    if (activity.status === 'in_progress') {
      return;
    }

    const index = toolIndex.get(activity.id) as number;

    if ((output[index] as OpenAiMcpCallItem).status !== 'in_progress') {
      return;
    }

    const item = buildMcpCallItem(activity);

    output[index] = item;
    emit('response.mcp_call_arguments.done', { item_id: item.id, output_index: index, arguments: item.arguments });
    emit(item.status === 'failed' ? 'response.mcp_call.failed' : 'response.mcp_call.completed', {
      item_id: item.id,
      output_index: index,
    });
    emit('response.output_item.done', { output_index: index, item });
  };

  sse.start({ [CHAT_ID_RESPONSE_HEADER]: options.chatId });
  emit('response.created', { response: responseObject('in_progress', []) });
  emit('response.in_progress', { response: responseObject('in_progress', []) });

  try {
    for await (const update of updates(handle)) {
      if (update.type === 'delta') {
        startMessage();
        streamedText += update.delta;
        emit('response.output_text.delta', { ...textBase(), delta: update.delta, logprobs: [] });
      } else if (update.type === 'tool_event') {
        const entry = applyToolEvent(tracker, update.event);

        if (request.toolActivity && entry) {
          toolItem(entry);
        }
      } else if (update.type === 'error') {
        const code = update.body.error.code ?? update.body.error.type;

        emit('error', { code, message: update.body.error.message, param: update.body.error.param });
        emit('response.failed', {
          response: responseObject('failed', output, undefined, { code, message: update.body.error.message }),
        });

        return;
      } else if (update.type === 'tool_calls') {
        finishMessage(streamedText, 'completed');

        for (const call of update.calls) {
          const index = output.length;
          const item = buildFunctionCallItem(call);

          output.push(item);
          emit('response.output_item.added', {
            output_index: index,
            item: { ...item, arguments: '', status: 'in_progress' },
          });
          emit('response.function_call_arguments.delta', {
            item_id: item.id,
            output_index: index,
            delta: item.arguments,
          });
          emit('response.function_call_arguments.done', {
            item_id: item.id,
            output_index: index,
            name: item.name,
            arguments: item.arguments,
          });
          emit('response.output_item.done', { output_index: index, item });
        }

        emit('response.completed', { response: responseObject('completed', output) });

        return;
      } else {
        const final = update.result;
        const status = final.finishReason === 'content_filter' ? 'incomplete' : 'completed';

        if (request.toolActivity) {
          const finalTools = new Map(collectToolActivity(final.response).map((activity) => [activity.id, activity]));

          if (toolIndex.size === 0) {
            finalTools.forEach((activity) => toolItem(activity));
          } else {
            tracker.list().forEach((activity) => {
              const latest = finalTools.get(activity.id) ?? activity;

              toolItem(latest.status === 'in_progress' ? { ...latest, status: 'completed' } : latest);
            });
          }
        }

        startMessage();
        const text = streamedText || final.text;

        if (!streamedText && text) {
          emit('response.output_text.delta', { ...textBase(), delta: text, logprobs: [] });
        }

        finishMessage(text, status);
        emit(status === 'completed' ? 'response.completed' : 'response.incomplete', {
          response: responseObject(status, output, final.usage),
        });

        return;
      }
    }
  } finally {
    sse.end();
  }
}
