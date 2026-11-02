import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, LOCALE_ID, OnInit } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { RouterModule } from '@angular/router';
import { ENVIRONMENT, type EnvironmentWithLandingAndCommunication } from '@forepath/shared/frontend/util-configuration';
import { addPageMetaTags, buildPageMetaTags, formatProductMetaTitle } from '@forepath/shared/frontend/util-meta';
import { FpcBadgeComponent, FpcButtonComponent } from '@forepath/shared/frontend/ui-components';

@Component({
  selector: 'loadweaver-portal-legal-terms',
  imports: [FpcBadgeComponent, FpcButtonComponent, CommonModule, RouterModule],
  styleUrls: ['./terms.component.scss'],
  templateUrl: './terms.component.html',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortalLegalTermsComponent implements OnInit {
  private readonly titleService = inject(Title);
  private readonly metaService = inject(Meta);
  private readonly environment = inject<EnvironmentWithLandingAndCommunication>(ENVIRONMENT);
  private readonly locale = inject(LOCALE_ID);
  private readonly destroyRef = inject(DestroyRef);

  ngOnInit(): void {
    const pageTitle = $localize`:@@featureLoadweaverLegalTerms-metaTitlePage:Terms of Service`;
    const metaTitle = formatProductMetaTitle(pageTitle, this.environment.application.productName);
    const metaDescription = $localize`:@@featureLoadweaverLegalTerms-metaDescription:Terms governing use of the Loadweaver platform, websites, and related services. Accounts, licensing, acceptable use, liability, and contact information.`;

    this.titleService.setTitle(metaTitle);
    this.destroyRef.onDestroy(
      addPageMetaTags(
        this.metaService,
        buildPageMetaTags({
          description: metaDescription,
          keywords: $localize`:@@featureLoadweaverLegalTerms-metaKeywords:Loadweaver, terms of service, resilient clusters`,
          author: 'IPvX UG (haftungsbeschränkt)',
          robots: 'index, follow',
          canonicalUrl: 'https://loadweaver.com/legal/terms',
          socialTitle: metaTitle,
          socialDescription: metaDescription,
          socialImageUrl: this.environment.socialPreview.urls.image,
          localeId: this.locale,
          localizeCanonicalUrl: this.environment.application.production,
          siteName: this.environment.application.productName,
        }),
      ),
    );
  }
}
