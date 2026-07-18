import { extractWebhookEventNames, parseWebhookEventsCatalog } from './parse-webhook-events';
import { webhookEventNodeId } from './schema';

describe('parseWebhookEvents', () => {
  const source = `
export const BILLING_NOTIFICATION_EVENTS = [
  'invoice.created',
  'invoice.issued',
  'payment.succeeded',
] as const;
`;

  it('should extract dotted event names', () => {
    expect(extractWebhookEventNames(source)).toEqual(['invoice.created', 'invoice.issued', 'payment.succeeded']);
  });

  it('should emit webhook-event nodes scoped to the project', () => {
    const result = parseWebhookEventsCatalog({
      relativePath: 'libs/demo/src/notifications/demo-notification.events.ts',
      source,
      projectName: 'demo-feature',
    });

    expect(result.nodes).toHaveLength(3);
    expect(result.nodes[0]).toMatchObject({
      id: webhookEventNodeId('demo-feature', 'invoice.created'),
      type: 'webhook-event',
      attrs: {
        eventName: 'invoice.created',
        projectName: 'demo-feature',
        catalogPath: 'libs/demo/src/notifications/demo-notification.events.ts',
      },
    });
    expect(result.edges).toEqual(
      expect.arrayContaining([
        {
          from: 'project:demo-feature',
          to: webhookEventNodeId('demo-feature', 'invoice.created'),
          type: 'contains',
        },
      ]),
    );
  });
});
