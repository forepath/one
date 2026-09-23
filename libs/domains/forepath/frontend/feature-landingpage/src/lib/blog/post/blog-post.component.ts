import { CommonModule, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal, LOCALE_ID } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DomSanitizer, Meta, SafeHtml, Title } from '@angular/platform-browser';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { FpcBadgeComponent, FpcButtonComponent } from '@forepath/shared/frontend/ui-components';
import { ENVIRONMENT, type Environment } from '@forepath/shared/frontend/util-configuration';
import {
  addPageMetaTags,
  buildPageMetaTags,
  formatAgenstraMetaDescription,
  formatProductMetaTitle,
} from '@forepath/shared/frontend/util-meta';
import { catchError, of, switchMap } from 'rxjs';

import { GhostContentApiService } from '../ghost-content-api.service';
import {
  GHOST_AI_GENERATED_LABEL_SRC,
  GHOST_AI_MODIFIED_LABEL_SRC,
  filterGhostDisplayTags,
  getGhostAiMarkers,
  resolveGhostPrimaryDisplayTag,
  type GhostAiMarkers,
} from '../ghost-ai-tags.util';
import {
  resolveGhostPostAuthorName,
  resolveGhostPostDescription,
  resolveGhostPostImageUrl,
  resolveGhostPostKeywords,
} from '../ghost-post-meta.util';
import type { GhostPost, GhostTag } from '../ghost.types';

function isGhostNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const ghostError = error as { type?: string; name?: string };
  return ghostError.type === 'NotFoundError' || ghostError.name === 'NotFoundError';
}

@Component({
  selector: 'framework-forepath-blog-post',
  imports: [CommonModule, RouterModule, DatePipe, FpcBadgeComponent, FpcButtonComponent],
  styleUrls: ['./blog-post.component.scss'],
  templateUrl: './blog-post.component.html',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ForepathBlogPostComponent implements OnInit {
  private readonly titleService = inject(Title);
  private readonly metaService = inject(Meta);
  private readonly environment = inject<Environment>(ENVIRONMENT);
  private readonly locale = inject(LOCALE_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly ghostApi = inject(GhostContentApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly sanitizer = inject(DomSanitizer);

  private removeMetaTags: (() => void) | null = null;

  readonly post = signal<GhostPost | null>(null);
  readonly safeHtml = signal<SafeHtml | null>(null);
  readonly loading = signal(true);
  readonly notFound = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly aiGeneratedLabelSrc = GHOST_AI_GENERATED_LABEL_SRC;
  readonly aiModifiedLabelSrc = GHOST_AI_MODIFIED_LABEL_SRC;

  primaryDisplayTag(post: GhostPost): GhostTag | null {
    return resolveGhostPrimaryDisplayTag(post);
  }

  displayTags(post: GhostPost): GhostTag[] {
    return filterGhostDisplayTags(post.tags);
  }

  aiMarkers(post: GhostPost): GhostAiMarkers {
    return getGhostAiMarkers(post);
  }

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => {
      this.removeMetaTags?.();
    });

    this.route.paramMap
      .pipe(
        switchMap((params) => {
          const slug = params.get('slug')?.trim() ?? '';
          this.loading.set(true);
          this.notFound.set(false);
          this.errorMessage.set(null);
          this.post.set(null);
          this.safeHtml.set(null);

          if (!slug) {
            this.loading.set(false);
            this.notFound.set(true);
            this.applyMissingMeta();
            return of(null);
          }

          return this.ghostApi.getPostBySlug(slug).pipe(
            catchError((error: unknown) => {
              if (isGhostNotFoundError(error)) {
                this.notFound.set(true);
                this.applyMissingMeta();
              } else {
                this.errorMessage.set(
                  $localize`:@@featureForepathBlogPost-loadError:We could not load this post right now. Please try again later.`,
                );
                this.applyMissingMeta();
              }
              return of(null);
            }),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((post) => {
        this.loading.set(false);
        if (!post) {
          return;
        }

        this.post.set(post);
        this.safeHtml.set(post.html ? this.sanitizer.bypassSecurityTrustHtml(post.html) : null);
        this.applyPostMeta(post);
      });
  }

  private applyPostMeta(post: GhostPost): void {
    const pageTitle = (post.meta_title ?? post.title).trim() || post.title;
    const metaTitle = formatProductMetaTitle(pageTitle, this.environment.productName);
    const description = formatAgenstraMetaDescription(
      resolveGhostPostDescription(post) ||
        $localize`:@@featureForepathBlogPost-fallbackDescription:Article from the ForePath blog.`,
    );
    const imageUrl = resolveGhostPostImageUrl(post, this.environment.socialPreview.imageUrl);
    const keywords = resolveGhostPostKeywords(post);

    this.titleService.setTitle(metaTitle);
    this.removeMetaTags?.();
    this.removeMetaTags = addPageMetaTags(
      this.metaService,
      buildPageMetaTags({
        description,
        keywords,
        author: resolveGhostPostAuthorName(post),
        robots: 'index, follow',
        canonicalUrl: `https://forepath.io/blog/${post.slug}`,
        socialTitle: metaTitle,
        socialDescription: description,
        socialImageUrl: imageUrl,
        localeId: this.locale,
        localizeCanonicalUrl: this.environment.production,
        socialType: 'article',
        siteName: 'ForePath',
      }),
    );
  }

  private applyMissingMeta(): void {
    const metaTitle = $localize`:@@featureForepathBlogPost-notFoundMetaTitle:Post not found :: ForePath`;
    const metaDescription = $localize`:@@featureForepathBlogPost-notFoundMetaDescription:The requested ForePath blog post could not be found.`;

    this.titleService.setTitle(metaTitle);
    this.removeMetaTags?.();
    this.removeMetaTags = addPageMetaTags(
      this.metaService,
      buildPageMetaTags({
        description: metaDescription,
        author: 'IPvX UG (haftungsbeschränkt)',
        robots: 'noindex, follow',
        canonicalUrl: 'https://forepath.io/blog',
        socialTitle: metaTitle,
        socialDescription: metaDescription,
        socialImageUrl: this.environment.socialPreview.imageUrl,
        localeId: this.locale,
        localizeCanonicalUrl: this.environment.production,
        siteName: 'ForePath',
      }),
    );
  }
}
