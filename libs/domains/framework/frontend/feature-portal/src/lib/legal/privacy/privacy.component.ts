import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, LOCALE_ID, OnInit } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { RouterModule } from '@angular/router';
import { ENVIRONMENT, type Environment } from '@forepath/framework/frontend/util-configuration';
import { addPageMetaTags, buildPageMetaTags } from '@forepath/framework/frontend/util-meta';

@Component({
  selector: 'framework-portal-legal-privacy',
  imports: [CommonModule, RouterModule],
  styleUrls: ['./privacy.component.scss'],
  templateUrl: './privacy.component.html',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortalLegalPrivacyComponent implements OnInit {
  private readonly titleService = inject(Title);
  private readonly metaService = inject(Meta);
  private readonly environment = inject<Environment>(ENVIRONMENT);
  private readonly locale = inject(LOCALE_ID);
  private readonly destroyRef = inject(DestroyRef);

  ngOnInit(): void {
    const metaTitle = $localize`:@@featurePortalPrivacy-metaTitle:Privacy Policy :: Agenstra`;
    const metaDescription = $localize`:@@featurePortalPrivacy-metaDescription:How Agenstra and IPvX process personal data when you use our platform, websites, and support. Cookies, retention, your rights, and how to contact us.`;

    this.titleService.setTitle(metaTitle);
    this.destroyRef.onDestroy(
      addPageMetaTags(
        this.metaService,
        buildPageMetaTags({
          description: metaDescription,
          keywords: $localize`:@@featurePortalPrivacy-metaKeywords:Agenstra, privacy policy, platform, distributed AI agent infrastructure`,
          author: 'IPvX UG (haftungsbeschränkt)',
          robots: 'index, follow',
          canonicalUrl: 'https://agenstra.com/legal/privacy',
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
