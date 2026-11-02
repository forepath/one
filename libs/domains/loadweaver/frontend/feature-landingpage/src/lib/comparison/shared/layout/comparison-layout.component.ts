import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { FpcButtonComponent } from '@forepath/shared/frontend/ui-components';
import { map } from 'rxjs';

import { LoadweaverEarlyAccessDirective } from '../../../shared/early-access';
import { injectPageMeta } from '../../../shared/page-meta';
import { PortalComparisonMatrixComponent } from '../matrix/comparison-matrix.component';
import type { ComparisonSlug } from '../matrix/comparison-matrix.model';
import { PORTAL_COMPARISON_NAV_ITEMS } from '../misc/comparison-nav.items';
import { COMPARISON_SLUG_DATA_KEY } from '../misc/comparison-page.model';
import { COMPARISON_PAGES } from '../misc/comparison-pages';

/** “{Competitor} vs Loadweaver” page; the competitor comes from the route data (`comparisonSlug`). */
@Component({
  selector: 'loadweaver-portal-comparison',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FpcButtonComponent,
    PortalComparisonMatrixComponent,
    LoadweaverEarlyAccessDirective,
  ],
  templateUrl: './comparison-layout.component.html',
  styleUrl: './comparison-layout.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortalComparisonComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly setPageMeta = injectPageMeta();

  private readonly slug = toSignal(
    this.route.data.pipe(map((data) => data[COMPARISON_SLUG_DATA_KEY] as ComparisonSlug)),
    { initialValue: this.route.snapshot.data[COMPARISON_SLUG_DATA_KEY] as ComparisonSlug },
  );

  protected readonly page = computed(() => COMPARISON_PAGES[this.slug()]);
  protected readonly otherComparisons = computed(() =>
    PORTAL_COMPARISON_NAV_ITEMS.filter((item) => item.slug !== this.slug()),
  );

  ngOnInit(): void {
    const page = this.page();

    this.setPageMeta({
      title: page.metaTitle,
      description: page.metaDescription,
      keywords: $localize`:@@featureLoadweaverComparison-metaKeywords:Loadweaver comparison, Kubernetes alternative, Docker Compose cluster, high availability, self-hosted cluster, multi-site`,
      path: `/compare/${page.slug}`,
    });
  }
}
