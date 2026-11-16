import {
  AGENT_HARNESS_MESSAGE_MAX_CHARS,
  AGENT_HARNESS_RELAY_CONTENT_TYPE,
  encodeAgentHarnessEvent,
  redactAgentHarnessEvent,
  type AgentHarnessEvent,
} from '@forepath/shared/shared/util-agent-harness';
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import type { Response } from 'express';

/** Keep-alive comment interval for relayed turns (reverse proxies close idle streams). */
export const AGENT_HARNESS_RELAY_KEEP_ALIVE_MS = 15_000;

/**
 * Request body of an application's chat endpoint that relays a harness turn to its frontend. The conversation must
 * belong to the caller: applications store which conversations a user owns and check that before relaying.
 */
export class AgentHarnessTurnRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(AGENT_HARNESS_MESSAGE_MAX_CHARS)
  message!: string;

  @IsOptional()
  @IsString()
  @Matches(/^(conv_[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i)
  conversationId?: string;
}

export interface AgentHarnessRelayOptions {
  /**
   * Send tool arguments and outputs to the browser (default false). Tool payloads can contain data the end user must
   * not see; enable only when every tool result is safe to show to the caller.
   */
  includeToolPayloads?: boolean;
  /** Filter or transform events before they are sent (return undefined to drop one). */
  map?: (event: AgentHarnessEvent) => AgentHarnessEvent | undefined;
}

/**
 * Streams a harness turn to an HTTP client as Server-Sent Events (read on the frontend with
 * `readAgentHarnessEvents`). The signal passed to `turn` is aborted when the client disconnects.
 *
 * ```ts
 * @Post('assistant/turns')
 * async turn(@Body() body: AgentHarnessTurnRequestDto, @Req() req, @Res() res: Response) {
 *   const conversationId = await this.conversations.assertOwned(req.user, body.conversationId);
 *
 *   await relayAgentHarnessTurn(res, (signal) =>
 *     this.harness.stream(body.message, { conversationId, context: { user: req.user }, signal }),
 *   );
 * }
 * ```
 */
export async function relayAgentHarnessTurn(
  res: Response,
  turn: (signal: AbortSignal) => AsyncIterable<AgentHarnessEvent>,
  options: AgentHarnessRelayOptions = {},
): Promise<void> {
  const controller = new AbortController();
  const closed = () => res.writableEnded || res.destroyed;

  res.on('close', () => {
    if (!res.writableEnded) {
      controller.abort();
    }
  });

  res.status(200);
  res.setHeader('Content-Type', AGENT_HARNESS_RELAY_CONTENT_TYPE);
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const keepAlive = setInterval(() => {
    if (!closed()) {
      res.write(': keep-alive\n\n');
    }
  }, AGENT_HARNESS_RELAY_KEEP_ALIVE_MS);

  keepAlive.unref?.();

  try {
    for await (const raw of turn(controller.signal)) {
      if (closed()) {
        break;
      }

      const visible = options.includeToolPayloads ? raw : redactAgentHarnessEvent(raw);
      const event = options.map ? options.map(visible) : visible;

      if (event) {
        res.write(encodeAgentHarnessEvent(event));
      }
    }
  } catch {
    if (!closed()) {
      res.write(
        encodeAgentHarnessEvent({
          type: 'turn.failed',
          error: { message: 'The agent turn failed', code: null, status: null },
        }),
      );
    }
  } finally {
    clearInterval(keepAlive);

    if (!closed()) {
      res.end();
    }
  }
}
