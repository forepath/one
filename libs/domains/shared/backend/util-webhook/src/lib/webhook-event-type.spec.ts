import {
  assertWebhookEventCatalog,
  findWebhookEventCatalogViolations,
  isWebhookEventTypeName,
} from './webhook-event-type';

describe('webhook event type naming', () => {
  it.each([
    'user.created',
    'invoice.paid',
    'ticket.comment.created',
    'customer_trust.level_changed',
    'isolation.sandbox_kvm_available',
  ])('accepts %s', (type) => {
    expect(isWebhookEventTypeName(type)).toBe(true);
  });

  it.each([
    'created',
    'Ticket.created',
    'ticket-created',
    'ticket.Created',
    'a.b.c.d',
    'ticket..created',
    '.ticket.created',
    'ticket.created.',
    'ticket_.created',
    'ticket.1created',
    'ticket.comment-created',
  ])('rejects %s', (type) => {
    expect(isWebhookEventTypeName(type)).toBe(false);
  });

  it('reports malformed and duplicate catalog entries', () => {
    expect(findWebhookEventCatalogViolations(['user.created', 'user.created', 'Bad'])).toEqual({
      invalid: ['Bad'],
      duplicates: ['user.created'],
    });
  });

  it('assertWebhookEventCatalog throws on violations and passes on a valid catalog', () => {
    expect(() => assertWebhookEventCatalog(['user.created', 'ticket.comment.created'])).not.toThrow();
    expect(() => assertWebhookEventCatalog(['user.created', 'user.created'])).toThrow(/duplicate: user\.created/);
    expect(() => assertWebhookEventCatalog(['agent.chat.failed.now'])).toThrow(/malformed/);
  });
});
