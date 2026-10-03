import { Injectable, PendingTasks, inject } from '@angular/core';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import type { ForepathLandingEnvironment } from '@forepath/forepath/frontend/util-configuration';
import GhostContentAPI from '@tryghost/content-api';
import { Observable, defer, finalize, from, throwError } from 'rxjs';
import { map } from 'rxjs/operators';

import type { BrowseGhostPostsParams, GhostPost, GhostPostsBrowseResult } from './ghost.types';

const DEFAULT_PAGE_LIMIT = 12;
const POST_INCLUDE = 'tags,authors';

/**
 * Escapes a user search string for Ghost NQL filter literals (single-quoted).
 */
export function buildGhostTitleSearchFilter(query: string): string | undefined {
  const trimmed = query.trim();
  if (!trimmed) {
    return undefined;
  }

  const escaped = trimmed.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `title:~'${escaped}'`;
}

@Injectable({ providedIn: 'root' })
export class GhostContentApiService {
  private readonly environment = inject<ForepathLandingEnvironment>(ENVIRONMENT);
  private readonly pendingTasks = inject(PendingTasks);
  private readonly api = this.createApi();

  browsePosts(params: BrowseGhostPostsParams = {}): Observable<GhostPostsBrowseResult> {
    if (!this.api) {
      return throwError(() => new Error('Ghost blog is not configured.'));
    }

    const page = params.page ?? 1;
    const limit = params.limit ?? DEFAULT_PAGE_LIMIT;
    const filter = params.query ? buildGhostTitleSearchFilter(params.query) : undefined;

    return this.trackPendingTask(
      defer(() =>
        from(
          this.api!.posts.browse({
            page,
            limit,
            include: POST_INCLUDE,
            ...(filter ? { filter } : {}),
          }),
        ),
      ).pipe(
        map((browseResult) => ({
          posts: browseResult as GhostPost[],
          meta: browseResult.meta,
        })),
      ),
    );
  }

  getPostBySlug(slug: string): Observable<GhostPost> {
    if (!this.api) {
      return throwError(() => new Error('Ghost blog is not configured.'));
    }

    const normalizedSlug = slug.trim();
    if (!normalizedSlug) {
      return throwError(() => new Error('Post slug is required.'));
    }

    return this.trackPendingTask(
      defer(() => from(this.api!.posts.read({ slug: normalizedSlug }, { include: POST_INCLUDE }))).pipe(
        map((post) => post as GhostPost),
      ),
    );
  }

  /**
   * Registers Ghost axios fetches with Angular PendingTasks so SSR/prerender
   * waits for content instead of serializing the loading UI.
   */
  private trackPendingTask<T>(source$: Observable<T>): Observable<T> {
    return defer(() => {
      const removeTask = this.pendingTasks.add();
      return source$.pipe(finalize(removeTask));
    });
  }

  private createApi(): ReturnType<typeof GhostContentAPI> | null {
    const blog = this.environment.blog;
    if (!blog?.urls.contentApi || !blog.contentApiKey) {
      return null;
    }

    try {
      return GhostContentAPI({
        url: blog.urls.contentApi.replace(/\/$/, ''),
        key: blog.contentApiKey,
        version: 'v5.0',
      });
    } catch (error) {
      console.error('Failed to create Ghost Content API instance:', error);
      return null;
    }
  }
}
