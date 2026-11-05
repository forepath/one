import { NotificationsModule } from './notifications.module';

describe('NotificationsModule.register', () => {
  const baseOptions = {
    applicationId: 'test',
    scopeMode: 'instance' as const,
    controllerPath: 'admin/webhooks',
    queueName: 'test-queue',
    resolveScopeKey: () => 'instance',
    assertAdmin: () => undefined,
  };

  it('accepts a catalog that follows the webhook event naming convention', () => {
    expect(() =>
      NotificationsModule.register({ ...baseOptions, eventCatalog: ['user.created', 'ticket.comment.created'] }),
    ).not.toThrow();
  });

  it('fails fast on malformed or duplicate event types', () => {
    expect(() =>
      NotificationsModule.register({ ...baseOptions, eventCatalog: ['payment.auto.retry.scheduled'] }),
    ).toThrow(/malformed/);
    expect(() =>
      NotificationsModule.register({ ...baseOptions, eventCatalog: ['user.created', 'user.created'] }),
    ).toThrow(/duplicate/);
  });
});
