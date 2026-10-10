import { SecurityContext } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

export function sanitizeAndTrustMarkdownHtml(sanitizer: DomSanitizer, html: string): SafeHtml {
  const sanitizedHtml = sanitizer.sanitize(SecurityContext.HTML, html) ?? '';

  return sanitizer.bypassSecurityTrustHtml(sanitizedHtml);
}
