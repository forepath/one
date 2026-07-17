import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { EmailTemplateRendererService } from './email-template-renderer.service';
import {
  emailTemplateFileName,
  loadEmailLayoutPartial,
  loadEmailTemplate,
  resetEmailTemplateCacheForTests,
} from './email-template.loader';

describe('EmailTemplateRendererService', () => {
  const roots = [path.resolve(process.cwd(), 'libs/domains/shared/backend/feature-notifications/src/lib/templates')];

  beforeEach(() => {
    resetEmailTemplateCacheForTests();
  });

  it('renders identity confirmation html and text', () => {
    const renderer = new EmailTemplateRendererService();
    const result = renderer.render(roots, 'email-confirmation', {
      code: 'ABC123',
      companyName: 'Acme GmbH',
      companyFrom: {
        name: 'Acme GmbH',
        lines: ['Main St 1', '12345 Berlin', 'Germany'],
        vatId: 'DE123',
        email: 'billing@acme.example',
      },
    });

    expect(result.html).toContain('ABC123');
    expect(result.html).toContain('Confirm your email');
    expect(result.html).toContain('Acme GmbH');
    expect(result.html).toContain('email-header-company');
    expect(result.html).toContain('email-issuer-footer');
    expect(result.html).toContain('Main St 1');
    expect(result.html).toContain('VAT: DE123');
    expect(result.text).toContain('Acme GmbH');
    expect(result.text).toContain('ABC123');
    expect(result.text).toContain('billing@acme.example');
  });

  it('reuses compiled templates and layout on subsequent renders', () => {
    const renderer = new EmailTemplateRendererService();

    renderer.render(roots, 'email-confirmation', { code: 'ONE' });
    const second = renderer.render(roots, 'email-confirmation', { code: 'TWO' });

    expect(second.html).toContain('TWO');
    expect(second.text).toContain('TWO');
  });

  it('omits text branding when company fields are missing or invalid', () => {
    const renderer = new EmailTemplateRendererService();
    const withoutBrand = renderer.render(roots, 'email-confirmation', { code: 'XYZ' });
    const invalidFrom = renderer.render(roots, 'email-confirmation', {
      code: 'XYZ',
      companyFrom: null,
    });
    const blankName = renderer.render(roots, 'email-confirmation', {
      code: 'XYZ',
      companyFrom: { name: '   ', lines: ['ignored'] },
    });

    expect(withoutBrand.text).toContain('XYZ');
    expect(withoutBrand.text).not.toMatch(/^Acme/);
    expect(invalidFrom.text).toContain('XYZ');
    expect(blankName.text).not.toContain('ignored');
  });

  it('ignores non-object companyFrom and empty optional fields', () => {
    const renderer = new EmailTemplateRendererService();
    const result = renderer.render(roots, 'password-reset', {
      code: 'RESET',
      companyFrom: 'not-an-object',
    });

    expect(result.html).toContain('RESET');
    expect(result.text).toContain('RESET');
    expect(result.text).not.toContain('From');
  });

  it('appends company footer without vat/email when omitted', () => {
    const renderer = new EmailTemplateRendererService();
    const result = renderer.render(roots, 'email-confirmation', {
      code: 'CODE',
      companyFrom: {
        name: 'Solo Co',
        lines: ['Line 1', '', 12, 'Line 2'],
        vatId: '   ',
        email: '',
      },
    });

    expect(result.text).toContain('Solo Co');
    expect(result.text).toContain('Line 1');
    expect(result.text).toContain('Line 2');
    expect(result.text).not.toContain('VAT:');
  });
});

describe('email-template.loader', () => {
  beforeEach(() => {
    resetEmailTemplateCacheForTests();
  });

  it('builds template file names', () => {
    expect(emailTemplateFileName('invoice-issued', 'html')).toBe('invoice-issued.template.html');
    expect(emailTemplateFileName('invoice-issued', 'text')).toBe('invoice-issued.template.txt');
  });

  it('caches loaded templates and layouts', () => {
    const roots = [path.resolve(process.cwd(), 'libs/domains/shared/backend/feature-notifications/src/lib/templates')];
    const first = loadEmailTemplate(roots, 'email-confirmation', 'html');
    const second = loadEmailTemplate(roots, 'email-confirmation', 'html');
    const layoutA = loadEmailLayoutPartial(roots);
    const layoutB = loadEmailLayoutPartial(roots);

    expect(second).toBe(first);
    expect(layoutB).toBe(layoutA);
  });

  it('resolves templates nested under a templates subdirectory', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'email-tpl-'));
    const nested = path.join(tmpRoot, 'templates');

    fs.mkdirSync(nested);
    fs.writeFileSync(path.join(nested, 'nested.template.txt'), 'nested-body', 'utf-8');

    try {
      expect(loadEmailTemplate([tmpRoot], 'nested', 'text')).toBe('nested-body');
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('throws when template cannot be found', () => {
    expect(() => loadEmailTemplate(['/tmp/does-not-exist-email-templates'], 'missing', 'html')).toThrow(
      /Email template not found/,
    );
  });
});
