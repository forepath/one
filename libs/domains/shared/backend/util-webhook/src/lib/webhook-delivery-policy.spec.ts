import { BadRequestException } from '@nestjs/common';

import { assertWebhookEndpointDeliveryPolicy, isWebhookSensitiveEventType } from './webhook-delivery-policy';

describe('assertWebhookEndpointDeliveryPolicy', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('rejects query_param auth in production', () => {
    process.env.NODE_ENV = 'production';

    expect(() =>
      assertWebhookEndpointDeliveryPolicy({
        httpMethod: 'GET',
        auth: { authType: 'query_param', authValue: 'secret' },
        subscribedEvents: ['ping.event'],
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects GET webhooks for sensitive events', () => {
    process.env.NODE_ENV = 'development';

    expect(() =>
      assertWebhookEndpointDeliveryPolicy({
        httpMethod: 'GET',
        auth: { authType: 'none' },
        subscribedEvents: ['chat_message.created'],
      }),
    ).toThrow('GET webhooks cannot subscribe to sensitive event types');
  });

  it.each([
    'agent.created',
    'agent.updated',
    'agent.deleted',
    'knowledge_node.created',
    'knowledge_node.updated',
    'knowledge_node.deleted',
    'invoice.paid',
  ])('treats content-bearing event %s as sensitive (no GET delivery)', (eventType) => {
    expect(isWebhookSensitiveEventType(eventType)).toBe(true);
  });
});
