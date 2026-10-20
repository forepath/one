import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, LOCALE_ID, OnInit } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { ENVIRONMENT, type EnvironmentWithLandingAndCommunication } from '@forepath/shared/frontend/util-configuration';
import { SharedContactPersonComponent } from '@forepath/shared/frontend/feature-landingpage';
import { addPageMetaTags, buildPageMetaTags } from '@forepath/shared/frontend/util-meta';
import { FpcButtonComponent } from '@forepath/shared/frontend/ui-components';

import { ForepathOneTeaserComponent } from '../../forepath-one-teaser/forepath-one-teaser.component';
import { forepathIndustryById, type ForepathIndustryId } from '../industries';

/** Route data key holding the `ForepathIndustryId` an industry page renders. */
export const FOREPATH_INDUSTRY_ROUTE_DATA_KEY = 'industry';

/** Landing page for one industry: its challenges and the ForePath offerings that answer them. */
@Component({
  selector: 'framework-forepath-industry',
  imports: [SharedContactPersonComponent, FpcButtonComponent, CommonModule, RouterModule, ForepathOneTeaserComponent],
  styleUrls: ['./industry.component.scss'],
  templateUrl: './industry.component.html',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ForepathIndustryComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly titleService = inject(Title);
  private readonly metaService = inject(Meta);
  private readonly environment = inject<EnvironmentWithLandingAndCommunication>(ENVIRONMENT);
  private readonly locale = inject(LOCALE_ID);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly industry = forepathIndustryById(
    this.route.snapshot.data[FOREPATH_INDUSTRY_ROUTE_DATA_KEY] as ForepathIndustryId,
  );

  ngOnInit(): void {
    const { metaTitle, metaDescription } = this.industry;

    this.titleService.setTitle(metaTitle);
    this.destroyRef.onDestroy(
      addPageMetaTags(
        this.metaService,
        buildPageMetaTags({
          description: metaDescription,
          keywords: this.industry.metaKeywords,
          author: 'IPvX UG (haftungsbeschränkt)',
          robots: 'index, follow',
          canonicalUrl: `https://forepath.io${this.industry.route}`,
          socialTitle: metaTitle,
          socialDescription: metaDescription,
          socialImageUrl: this.environment.socialPreview.urls.image,
          localeId: this.locale,
          localizeCanonicalUrl: this.environment.application.production,
        }),
      ),
    );
  }
}
