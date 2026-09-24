import { CommonModule, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal, LOCALE_ID } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcSearchFieldComponent,
} from '@forepath/shared/frontend/ui-components';
import { ENVIRONMENT, type Environment } from '@forepath/shared/frontend/util-configuration';
import { addPageMetaTags, buildPageMetaTags } from '@forepath/shared/frontend/util-meta';
import { Subject, catchError, debounceTime, distinctUntilChanged, finalize, of, switchMap, tap } from 'rxjs';

import { GhostContentApiService } from './ghost-content-api.service';
import {
  GHOST_AI_GENERATED_LABEL_ON_IMAGE_SRC,
  GHOST_AI_GENERATED_LABEL_SRC,
  GHOST_AI_MODIFIED_LABEL_ON_IMAGE_SRC,
  GHOST_AI_MODIFIED_LABEL_SRC,
  filterGhostDisplayTags,
  getGhostAiMarkers,
  type GhostAiMarkers,
} from './ghost-ai-tags.util';
import type { GhostPagination, GhostPost, GhostTag } from './ghost.types';

@Component({
  selector: 'framework-forepath-blog',
  imports: [
    CommonModule,
    RouterModule,
    ReactiveFormsModule,
    DatePipe,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcSearchFieldComponent,
  ],
  styleUrls: ['./blog.component.scss'],
  templateUrl: './blog.component.html',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ForepathBlogComponent implements OnInit {
  private readonly titleService = inject(Title);
  private readonly metaService = inject(Meta);
  private readonly environment = inject<Environment>(ENVIRONMENT);
  private readonly locale = inject(LOCALE_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly ghostApi = inject(GhostContentApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly loadPage$ = new Subject<{ page: number; query: string; append: boolean }>();

  readonly searchControl = new FormControl('', { nonNullable: true });
  readonly posts = signal<GhostPost[]>([]);
  readonly pagination = signal<GhostPagination | null>(null);
  readonly loading = signal(false);
  readonly loadingMore = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly activeQuery = signal('');

  readonly aiGeneratedLabelSrc = GHOST_AI_GENERATED_LABEL_SRC;
  readonly aiModifiedLabelSrc = GHOST_AI_MODIFIED_LABEL_SRC;
  readonly aiGeneratedLabelOnImageSrc = GHOST_AI_GENERATED_LABEL_ON_IMAGE_SRC;
  readonly aiModifiedLabelOnImageSrc = GHOST_AI_MODIFIED_LABEL_ON_IMAGE_SRC;

  displayTags(post: GhostPost): GhostTag[] {
    return filterGhostDisplayTags(post.tags);
  }

  aiMarkers(post: GhostPost): GhostAiMarkers {
    return getGhostAiMarkers(post);
  }

  ngOnInit(): void {
    this.applyListMeta();

    const initialQuery = this.route.snapshot.queryParamMap.get('q') ?? '';
    this.searchControl.setValue(initialQuery, { emitEvent: false });
    this.activeQuery.set(initialQuery.trim());

    this.searchControl.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        const query = value.trim();
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: query ? { q: query } : {},
          replaceUrl: true,
        });
        this.activeQuery.set(query);
        this.loadPage$.next({ page: 1, query, append: false });
      });

    this.loadPage$
      .pipe(
        tap(({ append }) => {
          this.errorMessage.set(null);
          if (append) {
            this.loadingMore.set(true);
          } else {
            this.loading.set(true);
          }
        }),
        switchMap(({ page, query, append }) =>
          this.ghostApi.browsePosts({ page, query }).pipe(
            tap((result) => {
              this.posts.set(append ? [...this.posts(), ...result.posts] : result.posts);
              this.pagination.set(result.meta.pagination);
            }),
            catchError(() => {
              this.errorMessage.set(
                $localize`:@@featureForepathBlog-loadError:We could not load blog posts right now. Please try again later.`,
              );
              if (!append) {
                this.posts.set([]);
                this.pagination.set(null);
              }
              return of(null);
            }),
            finalize(() => {
              this.loading.set(false);
              this.loadingMore.set(false);
            }),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();

    this.loadPage$.next({ page: 1, query: initialQuery.trim(), append: false });
  }

  loadMore(): void {
    const nextPage = this.pagination()?.next;
    if (nextPage == null || this.loading() || this.loadingMore()) {
      return;
    }

    this.loadPage$.next({ page: nextPage, query: this.activeQuery(), append: true });
  }

  private applyListMeta(): void {
    const metaTitle = $localize`:@@featureForepathBlog-metaTitle:Blog :: ForePath`;
    const metaDescription = $localize`:@@featureForepathBlog-metaDescription:Insights from ForePath on consulting, software engineering, IT systems, and shipping reliable platforms.`;

    this.titleService.setTitle(metaTitle);
    this.destroyRef.onDestroy(
      addPageMetaTags(
        this.metaService,
        buildPageMetaTags({
          description: metaDescription,
          keywords: $localize`:@@featureForepathBlog-metaKeywords:ForePath blog, consulting, software engineering, IT systems, cloud, DevOps`,
          author: 'IPvX UG (haftungsbeschränkt)',
          robots: 'index, follow',
          canonicalUrl: 'https://forepath.io/blog',
          socialTitle: metaTitle,
          socialDescription: metaDescription,
          socialImageUrl: this.environment.socialPreview.imageUrl,
          localeId: this.locale,
          localizeCanonicalUrl: this.environment.production,
          siteName: 'ForePath',
        }),
      ),
    );
  }
}
