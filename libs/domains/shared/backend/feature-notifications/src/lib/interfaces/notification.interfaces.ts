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
