import { DestroyRef, LOCALE_ID, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { ENVIRONMENT, type BaseEnvironment } from '@forepath/shared/frontend/util-configuration';
import { addPageMetaTags, buildPageMetaTags } from '@forepath/shared/frontend/util-meta';

export interface LoadweaverPageMeta {
  title: string;
  description: string;
  keywords: string;
  /** Path below https://loadweaver.com, e.g. `/pricing` (empty for the home page). */
  path: string;
}

/**
 * Sets title, description, canonical and social tags for a Loadweaver page and removes them when the
 * page is destroyed. Call from `ngOnInit` (needs an injection context: use it as a field initializer
 * factory, see `injectPageMeta`).
 */
export function injectPageMeta(): (meta: LoadweaverPageMeta) => void {
  const titleService = inject(Title);
  const metaService = inject(Meta);
  const environment = inject<BaseEnvironment>(ENVIRONMENT);
  const locale = inject(LOCALE_ID);
  const destroyRef = inject(DestroyRef);

  return (meta) => {
    titleService.setTitle(meta.title);
    destroyRef.onDestroy(
      addPageMetaTags(
        metaService,
        buildPageMetaTags({
          description: meta.description,
          keywords: meta.keywords,
          author: 'IPvX UG (haftungsbeschränkt)',
          robots: 'index, follow',
          canonicalUrl: `https://loadweaver.com${meta.path}`,
          socialTitle: meta.title,
          socialDescription: meta.description,
          socialImageUrl: environment.socialPreview.urls.image,
          localeId: locale,
          localizeCanonicalUrl: environment.application.production,
        }),
      ),
    );
  };
}
