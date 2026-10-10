import { SecurityContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';

import { sanitizeAndTrustMarkdownHtml } from './chat-markdown-html';

describe('sanitizeAndTrustMarkdownHtml', () => {
  it('removes executable markup while preserving safe markdown HTML', () => {
    const sanitizer = TestBed.inject(DomSanitizer);
    const html = '<h1>Plan</h1><img src="x" onerror="alert(1)"><a href="javascript:alert(1)">open</a>';
    const result = sanitizer.sanitize(SecurityContext.HTML, sanitizeAndTrustMarkdownHtml(sanitizer, html));

    expect(result).toContain('<h1>Plan</h1>');
    expect(result).not.toContain('onerror');
    expect(result).not.toContain('href="javascript:');
  });
});
