import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, Input, LOCALE_ID, OnInit } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { RouterModule } from '@angular/router';
import { ENVIRONMENT, type Environment } from '@forepath/framework/frontend/util-configuration';
import { addPageMetaTags, buildPageMetaTags } from '@forepath/framework/frontend/util-meta';

import { PortalComparisonMatrixComponent } from '../matrix/comparison-matrix.component';
import { PORTAL_COMPARISON_NAV_ITEMS } from '../misc/comparison-nav.items';
import type { ComparisonPageConfig } from '../misc/comparison-page.model';

@Component({
  selector: 'framework-portal-comparison-layout',
  standalone: true,
  imports: [CommonModule, RouterModule, PortalComparisonMatrixComponent],
  templateUrl: './comparison-layout.component.html',
  styleUrl: './comparison-layout.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortalComparisonLayoutComponent implements OnInit {
  @Input({ required: true }) page!: ComparisonPageConfig;

  private readonly titleService = inject(Title);
  private readonly metaService = inject(Meta);
  private readonly environment = inject<Environment>(ENVIRONMENT);
  private readonly locale = inject(LOCALE_ID);
  private readonly destroyRef = inject(DestroyRef);

  get otherComparisons() {
    return PORTAL_COMPARISON_NAV_ITEMS.filter((item) => item.slug !== this.page.slug);
  }

  ngOnInit(): void {
    this.titleService.setTitle(this.page.metaTitle);
    this.destroyRef.onDestroy(
      addPageMetaTags(
        this.metaService,
        buildPageMetaTags({
          description: this.page.metaDescription,
          keywords: $localize`:@@featurePortalComparison-metaKeywords:Agenstra comparison, AI agent platform, AI control plane, DevOps agents, self-hosted AI`,
          author: 'IPvX UG (haftungsbeschränkt)',
          robots: 'index, follow',
          canonicalUrl: this.page.canonicalUrl,
          socialTitle: this.page.metaTitle,
          socialDescription: this.page.metaDescription,
          socialImageUrl: this.environment.socialPreview.imageUrl,
          localeId: this.locale,
          localizeCanonicalUrl: this.environment.production,
        }),
      ),
    );
  }
}
