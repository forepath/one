export interface NotificationPublishContext {
  type: string;
  scopeKey: string;
  clientId?: string;
  data: Record<string, unknown>;
  correlationId?: string;
}

export interface WebhookDeliverJobPayload {
  endpointId: string;
  eventId: string;
  eventType: string;
  scopeKey: string;
  clientId?: string;
  envelope: NotificationEventEnvelope;
  attempt: number;
  maxAttempts?: number;
}

export interface WebhookDeliverOptions {
  throwOnFailure?: boolean;
  trackConsecutiveFailures?: boolean;
}

export interface EmailAttachmentRef {
  storageKey: string;
  filename: string;
}

export interface EmailDeliverJobPayload {
  eventId: string;
  eventType: string;
  scopeKey: string;
  to: string;
  templateKey: string;
  /** Non-sensitive template fields only (secrets live in encryptedTemplateSecrets). */
  templateContext: Record<string, unknown>;
  /** AES-256-GCM sealed sensitive template fields (OTP/reset codes). */
  encryptedTemplateSecrets?: string;
  attachments?: EmailAttachmentRef[];
  attempt: number;
  maxAttempts?: number;
}

export interface EmailPublishContext {
  eventType: string;
  scopeKey: string;
  to: string;
  templateKey: string;
  templateContext: Record<string, unknown>;
  attachments?: EmailAttachmentRef[];
  correlationId?: string;
}

export interface EmailAttachmentResolver {
  resolve(refs: EmailAttachmentRef[]): Promise<Array<{ filename: string; content: Buffer }>>;
}

export interface NotificationEventEnvelope {
  id: string;
  object: 'event';
  type: string;
  created: string;
  api_version: string;
  application: string;
  tenant_id?: string | null;
  client_id?: string | null;
  data: {
    object: Record<string, unknown>;
  };
}
