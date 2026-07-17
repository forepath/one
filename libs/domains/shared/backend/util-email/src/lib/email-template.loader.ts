import * as fs from 'fs';
import * as path from 'path';

export type EmailTemplateVariant = 'html' | 'text';

const templateCache = new Map<string, string>();

export function emailTemplateFileName(baseName: string, variant: EmailTemplateVariant): string {
  return `${baseName}.template.${variant === 'html' ? 'html' : 'txt'}`;
}

export function loadEmailTemplate(roots: string[], baseName: string, variant: EmailTemplateVariant): string {
  const cacheKey = `${roots.join('|')}::${baseName}::${variant}`;
  const cached = templateCache.get(cacheKey);

  if (cached !== undefined) {
    return cached;
  }

  const fileName = emailTemplateFileName(baseName, variant);
  const resolvedPath = resolveEmailTemplatePath(roots, fileName);
  const content = fs.readFileSync(resolvedPath, 'utf-8');

  templateCache.set(cacheKey, content);

  return content;
}

export function loadEmailLayoutPartial(roots: string[]): string {
  const cacheKey = `${roots.join('|')}::email-layout.partial.html`;
  const cached = templateCache.get(cacheKey);

  if (cached !== undefined) {
    return cached;
  }

  const resolvedPath = resolveEmailTemplatePath(roots, 'email-layout.partial.html');
  const content = fs.readFileSync(resolvedPath, 'utf-8');

  templateCache.set(cacheKey, content);

  return content;
}

function resolveEmailTemplatePath(roots: string[], fileName: string): string {
  const candidates: string[] = [];

  for (const root of roots) {
    candidates.push(path.join(root, fileName));
    candidates.push(path.join(root, 'templates', fileName));
  }

  candidates.push(path.join(process.cwd(), 'templates', fileName));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Email template not found (${fileName}). Searched: ${candidates.join(', ')}`);
}

/** @internal Test helper to reset memoized templates between test cases. */
export function resetEmailTemplateCacheForTests(): void {
  templateCache.clear();
}
