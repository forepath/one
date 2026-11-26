import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, LOCALE_ID, OnInit } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { RouterModule } from '@angular/router';
import {
  SharedContactPersonComponent,
  SharedHeroMascotComponent,
  SharedMarkStackComponent,
} from '@forepath/shared/frontend/feature-landingpage';
import { FpcButtonComponent } from '@forepath/shared/frontend/ui-components';
import { ENVIRONMENT, type EnvironmentWithLandingAndCommunication } from '@forepath/shared/frontend/util-configuration';
import { addPageMetaTags, buildPageMetaTags, formatProductMetaTitle } from '@forepath/shared/frontend/util-meta';

import { DesktopIllustrationComponent } from '../illustrations/desktop-illustration.component';
import { DesktopUpdateIllustrationComponent } from '../illustrations/desktop-update-illustration.component';

@Component({
  selector: 'framework-portal-desktop',
  imports: [
    SharedMarkStackComponent,
    SharedHeroMascotComponent,
    SharedContactPersonComponent,
    FpcButtonComponent,
    CommonModule,
    RouterModule,
    DesktopIllustrationComponent,
    DesktopUpdateIllustrationComponent,
  ],
  styleUrls: ['./desktop.component.scss'],
  templateUrl: './desktop.component.html',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortalDesktopComponent implements OnInit {
  private readonly titleService = inject(Title);
  private readonly metaService = inject(Meta);
  private readonly environment = inject<EnvironmentWithLandingAndCommunication>(ENVIRONMENT);
  private readonly locale = inject(LOCALE_ID);
  private readonly destroyRef = inject(DestroyRef);

  ngOnInit(): void {
    const pageTitle = $localize`:@@featureDecabillDesktop-metaTitlePage:Your billing console on the desktop`;
    const metaTitle = formatProductMetaTitle(pageTitle, this.environment.application.productName);
    const metaDescription = $localize`:@@featureDecabillDesktop-metaDescription:Decabill Desktop runs the billing console in its own window on Windows and Linux. Connect to your self-hosted Decabill or Decabill Cloud, with verified updates and signed package repositories.`;

    this.titleService.setTitle(metaTitle);
    this.destroyRef.onDestroy(
      addPageMetaTags(
        this.metaService,
        buildPageMetaTags({
          description: metaDescription,
          keywords: $localize`:@@featureDecabillDesktop-metaKeywords:Decabill Desktop, billing desktop app, invoicing app for Windows, invoicing app for Linux, billing console`,
          author: 'IPvX UG (haftungsbeschränkt)',
          robots: 'index, follow',
          canonicalUrl: 'https://decabill.com/desktop',
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
