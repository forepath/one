import { randomUUID } from 'node:crypto';

import { Client, credentials, Metadata, type ClientDuplexStream, type ServiceDefinition } from '@grpc/grpc-js';
import type { z } from 'zod';

import { decodeEnvelope, encodeEnvelope, MAX_ENVELOPE_BYTES, type Envelope } from './envelope';
import {
  AGENT_TO_CONTROL_PLANE,
  CONTROL_PLANE_TO_AGENT,
  type AgentMessageType,
  type ControlPlaneMessageType,
} from './messages';

type Catalog = Record<string, z.ZodType>;

export type DecodedMessage<C extends Catalog> = {
  [K in keyof C & string]: { type: K; id: string; correlationId?: string; channel?: string; payload: z.infer<C[K]> };
}[keyof C & string];

export type DecodeResult<C extends Catalog> = { ok: true; message: DecodedMessage<C> } | { ok: false; error: string };

function buildEnvelope(
  type: string,
  payload: unknown,
  opts: { correlationId?: string; channel?: string } = {},
): Envelope {
  return {
    type,
    id: randomUUID(),
    correlationId: opts.correlationId,
    channel: opts.channel,
    payload: new TextEncoder().encode(JSON.stringify(payload)),
  };
}

function decodeWith<C extends Catalog>(catalog: C, envelope: Envelope): DecodeResult<C> {
  const schema = catalog[envelope.type];

  if (!schema) return { ok: false, error: `unknown message type ${envelope.type}` };

  let json: unknown;

  try {
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(envelope.payload));
  } catch {
    return { ok: false, error: 'payload is not valid JSON' };
  }

  const parsed = schema.safeParse(json);

  if (!parsed.success)
    return {
      ok: false,
      error: `invalid ${envelope.type} payload: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    };

  return {
    ok: true,
    message: {
      type: envelope.type,
      id: envelope.id,
      correlationId: envelope.correlationId,
      channel: envelope.channel,
      payload: parsed.data,
    } as DecodedMessage<C>,
  };
}

/** Builds a validated message sent by the agent. */
export function agentMessage<T extends AgentMessageType>(
  type: T,
  payload: z.input<(typeof AGENT_TO_CONTROL_PLANE)[T]>,
  opts?: { correlationId?: string; channel?: string },
): Envelope {
  AGENT_TO_CONTROL_PLANE[type].parse(payload);

  return buildEnvelope(type, payload, opts);
}

/** Builds a validated message sent by the control plane. */
export function controlPlaneMessage<T extends ControlPlaneMessageType>(
  type: T,
  payload: z.input<(typeof CONTROL_PLANE_TO_AGENT)[T]>,
  opts?: { correlationId?: string; channel?: string },
): Envelope {
  CONTROL_PLANE_TO_AGENT[type].parse(payload);

  return buildEnvelope(type, payload, opts);
}

export function decodeAgentMessage(envelope: Envelope): DecodeResult<typeof AGENT_TO_CONTROL_PLANE> {
  return decodeWith(AGENT_TO_CONTROL_PLANE, envelope);
}

export function decodeControlPlaneMessage(envelope: Envelope): DecodeResult<typeof CONTROL_PLANE_TO_AGENT> {
  return decodeWith(CONTROL_PLANE_TO_AGENT, envelope);
}

const serialize = (envelope: Envelope): Buffer => Buffer.from(encodeEnvelope(envelope));
const deserialize = (buf: Buffer): Envelope => decodeEnvelope(buf);

/** grpc-js service definition for `loadweaver.agent.v1.NodeAgent` (proto/agent.proto). */
export const NODE_AGENT_SERVICE: ServiceDefinition = {
  connect: {
    path: '/loadweaver.agent.v1.NodeAgent/Connect',
    requestStream: true,
    responseStream: true,
    requestSerialize: serialize,
    requestDeserialize: deserialize,
    responseSerialize: serialize,
    responseDeserialize: deserialize,
  },
};

export interface AgentStreamTls {
  caCertificatePem: string;
  certificatePem: string;
  privateKeyPem: string;
}

export interface AgentStreamConnection {
  client: Client;
  stream: ClientDuplexStream<Envelope, Envelope>;
}

/**
 * Opens the node's outbound stream (3.19) with mutual TLS: the agent presents its node certificate and only
 * trusts control-plane certificates issued by the cluster CA.
 */
export function openAgentStream(
  endpoint: string,
  tls: AgentStreamTls,
  options: { keepaliveMs?: number } = {},
): AgentStreamConnection {
  const client = new Client(
    endpoint,
    credentials.createSsl(
      Buffer.from(tls.caCertificatePem),
      Buffer.from(tls.privateKeyPem),
      Buffer.from(tls.certificatePem),
    ),
    {
      'grpc.max_receive_message_length': MAX_ENVELOPE_BYTES,
      'grpc.max_send_message_length': MAX_ENVELOPE_BYTES,
      'grpc.keepalive_time_ms': options.keepaliveMs ?? 20_000,
      'grpc.keepalive_permit_without_calls': 1,
    },
  );
  const def = NODE_AGENT_SERVICE['connect'];
  const stream = client.makeBidiStreamRequest<Envelope, Envelope>(
    def.path,
    def.requestSerialize,
    def.responseDeserialize,
    new Metadata(),
  );

  return { client, stream };
}
