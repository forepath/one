import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, LOCALE_ID, OnInit } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { RouterModule } from '@angular/router';
import { ENVIRONMENT, type Environment } from '@forepath/framework/frontend/util-configuration';
import { addPageMetaTags, buildPageMetaTags } from '@forepath/framework/frontend/util-meta';

@Component({
  selector: 'framework-portal-legal-terms',
  imports: [CommonModule, RouterModule],
  styleUrls: ['./terms.component.scss'],
  templateUrl: './terms.component.html',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortalLegalTermsComponent implements OnInit {
  private readonly titleService = inject(Title);
  private readonly metaService = inject(Meta);
  private readonly environment = inject<Environment>(ENVIRONMENT);
  private readonly locale = inject(LOCALE_ID);
  private readonly destroyRef = inject(DestroyRef);

  ngOnInit(): void {
    const metaTitle = $localize`:@@featurePortalTerms-metaTitle:Terms of Service :: Agenstra`;
    const metaDescription = $localize`:@@featurePortalTerms-metaDescription:Terms governing use of the Agenstra platform, websites, and related services. Accounts, licensing, acceptable use, liability, and contact information.`;

    this.titleService.setTitle(metaTitle);
    this.destroyRef.onDestroy(
      addPageMetaTags(
        this.metaService,
        buildPageMetaTags({
          description: metaDescription,
          keywords: $localize`:@@featurePortalTerms-metaKeywords:Agenstra, terms of service, platform, distributed AI agent infrastructure`,
          author: 'IPvX UG (haftungsbeschränkt)',
          robots: 'index, follow',
          canonicalUrl: 'https://agenstra.com/legal/terms',
          socialTitle: metaTitle,
          socialDescription: metaDescription,
          socialImageUrl: this.environment.socialPreview.imageUrl,
          localeId: this.locale,
          localizeCanonicalUrl: this.environment.production,
        }),
      ),
    );
  }
}
