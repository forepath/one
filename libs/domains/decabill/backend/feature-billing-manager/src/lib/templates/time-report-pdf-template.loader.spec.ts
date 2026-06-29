import * as fs from 'fs';
import * as path from 'path';

import { loadTimeReportPdfTemplate, resetTimeReportPdfTemplateCacheForTests } from './time-report-pdf-template.loader';

describe('time-report-pdf-template.loader', () => {
  beforeEach(() => {
    resetTimeReportPdfTemplateCacheForTests();
  });

  it('loads the Handlebars template from the templates directory', () => {
    const template = loadTimeReportPdfTemplate();

    expect(template.toLowerCase()).toContain('<!doctype html>');
    expect(template).toContain('{{title}}');
    expect(template).toContain('{{companyName}}');
    expect(template).toContain('{{projectName}}');
    expect(template).toContain('{{rangeLabel}}');
    expect(template).toContain('--surface-subtle: #f4f4f4');
    expect(fs.existsSync(path.join(__dirname, 'time-report-pdf.template.html'))).toBe(true);
  });
});
