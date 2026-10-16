import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, LOCALE_ID, OnInit } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { ENVIRONMENT, type EnvironmentWithLandingAndCommunication } from '@forepath/shared/frontend/util-configuration';
import { SharedContactPersonComponent, SharedLogoGridComponent } from '@forepath/shared/frontend/feature-landingpage';
import { addPageMetaTags, buildPageMetaTags } from '@forepath/shared/frontend/util-meta';
import { FpcButtonComponent } from '@forepath/shared/frontend/ui-components';

import { ForepathOneTeaserComponent } from '../../forepath-one-teaser/forepath-one-teaser.component';
import { OperationsIllustrationComponent } from '../../illustrations/operations-illustration.component';
import {
  FOREPATH_DISTRIBUTOR_LOGOS,
  FOREPATH_IT_SERVICES,
  forepathItServiceById,
  type ForepathItServiceId,
} from '../services/it-systems-services';

/** Route data key holding the `ForepathItServiceId` a service page renders. */
export const FOREPATH_IT_SERVICE_ROUTE_DATA_KEY = 'itService';

/** Landing page for one managed IT domain (the cards on the IT systems page). */
@Component({
  selector: 'framework-forepath-it-systems-service',
  imports: [
    SharedContactPersonComponent,
    FpcButtonComponent,
    CommonModule,
    RouterModule,
    SharedLogoGridComponent,
    ForepathOneTeaserComponent,
    OperationsIllustrationComponent,
  ],
  styleUrls: ['./it-systems-service.component.scss'],
  templateUrl: './it-systems-service.component.html',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ForepathItSystemsServiceComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly titleService = inject(Title);
  private readonly metaService = inject(Meta);
  private readonly environment = inject<EnvironmentWithLandingAndCommunication>(ENVIRONMENT);
  private readonly locale = inject(LOCALE_ID);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly service = forepathItServiceById(
    this.route.snapshot.data[FOREPATH_IT_SERVICE_ROUTE_DATA_KEY] as ForepathItServiceId,
  );
  protected readonly railIcons = FOREPATH_IT_SERVICES.map((service) => service.icon);
  protected readonly distributorSlots = FOREPATH_DISTRIBUTOR_LOGOS.map((logo) => [logo]);

  ngOnInit(): void {
    const { metaTitle, metaDescription } = this.service;

    this.titleService.setTitle(metaTitle);
    this.destroyRef.onDestroy(
      addPageMetaTags(
        this.metaService,
        buildPageMetaTags({
          description: metaDescription,
          keywords: this.service.metaKeywords,
          author: 'IPvX UG (haftungsbeschränkt)',
          robots: 'index, follow',
          canonicalUrl: `https://forepath.io${this.service.route}`,
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
