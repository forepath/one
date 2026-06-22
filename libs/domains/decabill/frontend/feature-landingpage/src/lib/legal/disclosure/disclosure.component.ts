import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, LOCALE_ID, OnInit } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { RouterModule } from '@angular/router';
import { ENVIRONMENT, type Environment } from '@forepath/shared/frontend/util-configuration';
import { addPageMetaTags, buildPageMetaTags, formatProductMetaTitle } from '@forepath/shared/frontend/util-meta';

@Component({
  selector: 'framework-portal-legal-disclosure',
  imports: [CommonModule, RouterModule],
  styleUrls: ['./disclosure.component.scss'],
  templateUrl: './disclosure.component.html',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortalLegalDisclosureComponent implements OnInit {
  private readonly titleService = inject(Title);
  private readonly metaService = inject(Meta);
  private readonly environment = inject<Environment>(ENVIRONMENT);
  private readonly locale = inject(LOCALE_ID);
  private readonly destroyRef = inject(DestroyRef);

  ngOnInit(): void {
    const pageTitle = $localize`:@@featureDecabillLegalDisclosure-metaTitlePage:Legal Disclosure`;
    const metaTitle = formatProductMetaTitle(pageTitle, this.environment.productName);
    const metaDescription = $localize`:@@featureDecabillLegalDisclosure-metaDescription:Imprint and legal disclosure for Decabill by IPvX UG (haftungsbeschränkt). Company details, representation, and regulatory information for Germany.`;

    this.titleService.setTitle(metaTitle);
    this.destroyRef.onDestroy(
      addPageMetaTags(
        this.metaService,
        buildPageMetaTags({
          description: metaDescription,
          keywords: $localize`:@@featureDecabillLegalDisclosure-metaKeywords:Decabill, legal disclosure, billing platform`,
          author: 'IPvX UG (haftungsbeschränkt)',
          robots: 'index, follow',
          canonicalUrl: 'https://decabill.com/legal/disclosure',
          socialTitle: metaTitle,
          socialDescription: metaDescription,
          socialImageUrl: this.environment.socialPreview.imageUrl,
          localeId: this.locale,
          localizeCanonicalUrl: this.environment.production,
          siteName: this.environment.productName,
        }),
      ),
    );
  }
}
