import { Injectable, inject, signal } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';

import { sanitizeAndTrustMarkdownHtml } from '../chat/chat-markdown-html';

interface MarkdownParser {
  parse(markdown: string, options?: { breaks?: boolean; gfm?: boolean }): string;
}

const CACHE_MAX = 200;

/** Sanitized markdown rendering for documents, agent turns and proposals (same pipeline as plans and chats). */
@Injectable()
export class InitiativeMarkdownRenderer {
  private readonly sanitizer = inject(DomSanitizer);
  private readonly parser = signal<MarkdownParser | null>(null);
  private readonly cache = new Map<string, SafeHtml>();

  constructor() {
    void import('marked').then((module) => this.parser.set(module.marked));
  }

  render(text: string | null | undefined): SafeHtml | null {
    const parser = this.parser();

    if (!parser || !text) {
      return null;
    }

    const cached = this.cache.get(text);

    if (cached) {
      return cached;
    }

    try {
      const html = sanitizeAndTrustMarkdownHtml(this.sanitizer, parser.parse(text, { breaks: true, gfm: true }));

      if (this.cache.size >= CACHE_MAX) {
        this.cache.delete(this.cache.keys().next().value as string);
      }

      this.cache.set(text, html);

      return html;
    } catch {
      return null;
    }
  }
}
