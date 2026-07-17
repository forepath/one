import * as path from 'path';

import { resolveBillingEmailTemplateRoots } from './resolve-billing-email-template-roots';

describe('resolveBillingEmailTemplateRoots', () => {
  it('returns candidate template roots including source templates dir', () => {
    const roots = resolveBillingEmailTemplateRoots();

    expect(roots.length).toBeGreaterThan(0);
    expect(roots.some((root) => root.includes('templates'))).toBe(true);
    expect(roots.every((root) => path.isAbsolute(root))).toBe(true);
  });
});
