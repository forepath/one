import { Injectable, inject } from '@angular/core';
import { Marp } from '@marp-team/marp-core';
import { PresentationAssetsService } from '@forepath/marpdown/frontend/data-access-editor';
import { firstValueFrom } from 'rxjs';

import { disablePaginationInMarkdown } from './marp-markdown.utils';

export interface PresentationMarpRenderOptions {
  hidePagination?: boolean;
}

export interface PresentationMarpRenderResult {
  html: string;
  slideCount: number;
  dispose: () => void;
}

@Injectable({ providedIn: 'root' })
export class PresentationMarpRenderService {
  private readonly assetsService = inject(PresentationAssetsService);

  async render(
    presentationId: string,
    markdown: string,
    options: PresentationMarpRenderOptions = {},
  ): Promise<PresentationMarpRenderResult> {
    const blobUrls = new Set<string>();
    const sourceMarkdown = options.hidePagination ? disablePaginationInMarkdown(markdown) : markdown;
    const rewritten = await this.rewriteAssetUrls(presentationId, sourceMarkdown, blobUrls);
    const marp = new Marp();
    const { html, css } = marp.render(rewritten);

    const container = document.createElement('div');

    container.innerHTML = html;
    const slideCount = Math.max(container.querySelectorAll('svg[data-marpit-svg]').length, 1);
    const presenterCss = options.hidePagination
      ? 'div.marpit > svg > foreignObject > section::after{display:none!important}'
      : '';
    const styleBlock = presenterCss ? `<style>${css}${presenterCss}</style>` : `<style>${css}</style>`;

    return {
      html: `${styleBlock}${html}`,
      slideCount,
      dispose: () => {
        for (const url of blobUrls) {
          URL.revokeObjectURL(url);
        }
      },
    };
  }

  private async rewriteAssetUrls(
    presentationId: string,
    markdown: string,
    blobUrls: Set<string>,
  ): Promise<string> {
    const assetPattern = /(!\[[^\]]*]\()([^)\s]+)(\))/g;
    const matches = [...markdown.matchAll(assetPattern)];

    if (matches.length === 0) {
      return markdown;
    }

    let rewritten = markdown;

    for (const match of matches) {
      const originalPath = match[2];

      if (
        !originalPath ||
        originalPath.startsWith('http://') ||
        originalPath.startsWith('https://') ||
        originalPath.startsWith('data:')
      ) {
        continue;
      }

      const normalizedPath = originalPath.replace(/^\.\//, '');

      try {
        const content = await firstValueFrom(this.assetsService.readAsset(presentationId, normalizedPath));
        const bytes = Uint8Array.from(atob(content.content), (char) => char.charCodeAt(0));
        const blob = new Blob([bytes], { type: content.mimeType });
        const blobUrl = URL.createObjectURL(blob);

        blobUrls.add(blobUrl);
        rewritten = rewritten.replace(originalPath, blobUrl);
      } catch {
        // Keep original path when asset cannot be loaded.
      }
    }

    return rewritten;
  }
}
