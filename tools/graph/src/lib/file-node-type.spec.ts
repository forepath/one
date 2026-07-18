import {
  classifyTsSourceTypeFromPath,
  emailTemplateStem,
  fileNodeTypeFromKind,
  fileNodeTypeFromPath,
  isDomainProviderSource,
  isEmailTemplateFile,
  isIndexedTsSourceFile,
  isWebhookEventsCatalogFile,
} from './schema';

describe('fileNodeTypeFromKind / fileNodeTypeFromPath', () => {
  it('should map specs, docs, readmes, and diagrams to dedicated types', () => {
    expect(fileNodeTypeFromKind('openapi')).toBe('openapi');
    expect(fileNodeTypeFromKind('asyncapi')).toBe('asyncapi');
    expect(fileNodeTypeFromKind('mmd')).toBe('diagram');
    expect(fileNodeTypeFromKind('md', 'docs/decabill/features/webhooks.md')).toBe('doc');
    expect(fileNodeTypeFromKind('md', 'libs/foo/README.md')).toBe('readme');
    expect(fileNodeTypeFromKind('md', 'AGENTS.md')).toBe('readme');
    expect(fileNodeTypeFromKind('template', 'libs/foo/templates/invoice-issued')).toBe('email');
  });

  it('should map TS architectural suffixes to dedicated types by priority', () => {
    expect(fileNodeTypeFromPath('ts', 'a.job-handler.ts')).toBe('job');
    expect(fileNodeTypeFromPath('ts', 'a.controller.ts')).toBe('controller');
    expect(fileNodeTypeFromPath('ts', 'weird.controller.extra.ts')).toBe('controller');
    expect(fileNodeTypeFromPath('ts', 'a.gateway.ts')).toBe('gateway');
    expect(fileNodeTypeFromPath('ts', 'a.repository.ts')).toBe('repository');
    expect(fileNodeTypeFromPath('ts', 'a.entity.ts')).toBe('entity');
    expect(fileNodeTypeFromPath('ts', 'create-invoice.dto.ts')).toBe('dto');
    expect(fileNodeTypeFromPath('ts', 'a.guard.ts')).toBe('guard');
    expect(fileNodeTypeFromPath('ts', 'a.module.ts')).toBe('module');
    expect(fileNodeTypeFromPath('ts', 'a.service.ts')).toBe('service');
  });

  it('should classify backend domain providers and payment processors', () => {
    expect(
      classifyTsSourceTypeFromPath(
        'libs/domains/agenstra/backend/feature-agent-manager/src/lib/providers/pipelines/github.provider.ts',
      ),
    ).toBe('provider');
    expect(
      classifyTsSourceTypeFromPath(
        'libs/domains/decabill/backend/feature-billing-manager/src/lib/payment-processors/processors/stripe-payment.processor.ts',
      ),
    ).toBe('provider');
    expect(isDomainProviderSource('libs/domains/identity/frontend/util-auth/src/lib/keycloak.provider.ts')).toBe(false);
    expect(
      isDomainProviderSource(
        'libs/domains/agenstra/frontend/feature-agent-console/src/lib/providers/notification-admin.providers.ts',
      ),
    ).toBe(false);
  });

  it('should recognize email templates and webhook catalogs', () => {
    expect(isEmailTemplateFile('invoice-issued.template.html')).toBe(true);
    expect(isEmailTemplateFile('email-layout.partial.html')).toBe(false);
    expect(isEmailTemplateFile('invoice-pdf.template.html')).toBe(false);
    expect(emailTemplateStem('invoice-issued.template.txt')).toBe('invoice-issued');
    expect(isWebhookEventsCatalogFile('billing-notification.events.ts')).toBe(true);
    expect(isIndexedTsSourceFile('billing-notification.events.ts')).toBe(true);
  });

  it('should not classify job-handler as service', () => {
    expect(fileNodeTypeFromPath('ts', 'invoice-overdue.job-handler.ts')).toBe('job');
  });

  it('should leave unmatched TS unclassified (not indexed)', () => {
    expect(classifyTsSourceTypeFromPath('helpers.ts')).toBeNull();
    expect(isIndexedTsSourceFile('helpers.ts')).toBe(false);
    expect(() => fileNodeTypeFromPath('ts', 'helpers.ts')).toThrow(/Unclassified TypeScript source/);
  });

  it('should detect indexed TS source files', () => {
    expect(isIndexedTsSourceFile('invoices.controller.ts')).toBe(true);
    expect(isIndexedTsSourceFile('invoices.service.ts')).toBe(true);
    expect(isIndexedTsSourceFile('invoices.service.spec.ts')).toBe(false);
    expect(isIndexedTsSourceFile('helpers.ts')).toBe(false);
  });
});
