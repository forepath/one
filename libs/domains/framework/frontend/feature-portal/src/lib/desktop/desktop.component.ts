import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, LOCALE_ID, OnInit } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { RouterModule } from '@angular/router';
import { ENVIRONMENT, type Environment } from '@forepath/framework/frontend/util-configuration';
import { addPageMetaTags, buildPageMetaTags } from '@forepath/framework/frontend/util-meta';

@Component({
  selector: 'framework-portal-desktop',
  imports: [CommonModule, RouterModule],
  styleUrls: ['./desktop.component.scss'],
  templateUrl: './desktop.component.html',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortalDesktopComponent implements OnInit {
  private readonly titleService = inject(Title);
  private readonly metaService = inject(Meta);
  private readonly environment = inject<Environment>(ENVIRONMENT);
  private readonly locale = inject(LOCALE_ID);
  private readonly destroyRef = inject(DestroyRef);

  ngOnInit(): void {
    const metaTitle = $localize`:@@featurePortalDesktop-metaTitle:Your local control center for AI agents :: Agenstra`;
    const metaDescription = $localize`:@@featurePortalDesktop-metaDescription:Local control center for Agenstra: connect to your workspace, inspect agents, and manage context from the desktop app developers use every day.`;

    this.titleService.setTitle(metaTitle);
    this.destroyRef.onDestroy(
      addPageMetaTags(
        this.metaService,
        buildPageMetaTags({
          description: metaDescription,
          keywords:
            'Agenstra Desktop, AI agent desktop app, desktop client for AI agent management, local interface for AI agent orchestration, developer desktop app',
          author: 'IPvX UG (haftungsbeschränkt)',
          robots: 'index, follow',
          canonicalUrl: 'https://agenstra.com/desktop',
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
