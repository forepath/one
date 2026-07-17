import { Injectable } from '@nestjs/common';
import * as Handlebars from 'handlebars';

import { loadEmailLayoutPartial, loadEmailTemplate } from './email-template.loader';

export interface RenderedEmailBodies {
  html: string;
  text: string;
}

@Injectable()
export class EmailTemplateRendererService {
  private readonly compiledHtml = new Map<string, Handlebars.TemplateDelegate>();
  private readonly compiledText = new Map<string, Handlebars.TemplateDelegate>();
  private readonly registeredLayouts = new Set<string>();

  render(roots: string[], templateKey: string, context: Record<string, unknown>): RenderedEmailBodies {
    this.ensureLayoutRegistered(roots);

    const htmlKey = `${roots.join('|')}::${templateKey}::html`;
    const textKey = `${roots.join('|')}::${templateKey}::text`;
    let htmlTemplate = this.compiledHtml.get(htmlKey);

    if (!htmlTemplate) {
      htmlTemplate = Handlebars.compile(loadEmailTemplate(roots, templateKey, 'html'));
      this.compiledHtml.set(htmlKey, htmlTemplate);
    }

    let textTemplate = this.compiledText.get(textKey);

    if (!textTemplate) {
      textTemplate = Handlebars.compile(loadEmailTemplate(roots, templateKey, 'text'));
      this.compiledText.set(textKey, textTemplate);
    }

    const html = htmlTemplate(context);
    let text = textTemplate(context);
    const companyName = typeof context.companyName === 'string' ? context.companyName.trim() : '';
    const companyFrom = parseCompanyFrom(context.companyFrom);

    if (companyName.length > 0) {
      text = `${companyName}\n\n${text}`;
    }

    if (companyFrom) {
      const footerLines = [
        companyFrom.name,
        ...companyFrom.lines,
        ...(companyFrom.vatId ? [`VAT: ${companyFrom.vatId}`] : []),
        ...(companyFrom.email ? [companyFrom.email] : []),
      ];

      text = `${text}\n\n${footerLines.join('\n')}`;
    }

    return { html, text };
  }

  private ensureLayoutRegistered(roots: string[]): void {
    const layoutKey = roots.join('|');

    if (this.registeredLayouts.has(layoutKey)) {
      return;
    }

    Handlebars.registerPartial('email-layout', loadEmailLayoutPartial(roots));
    this.registeredLayouts.add(layoutKey);
  }
}

function parseCompanyFrom(value: unknown): { name: string; lines: string[]; vatId?: string; email?: string } | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name.trim() : '';

  if (!name) {
    return null;
  }

  const lines = Array.isArray(record.lines)
    ? record.lines.filter((line): line is string => typeof line === 'string' && line.trim().length > 0)
    : [];
  const vatId = typeof record.vatId === 'string' && record.vatId.trim() ? record.vatId.trim() : undefined;
  const email = typeof record.email === 'string' && record.email.trim() ? record.email.trim() : undefined;

  return { name, lines, ...(vatId ? { vatId } : {}), ...(email ? { email } : {}) };
}
