import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, LOCALE_ID, OnInit } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { RouterModule } from '@angular/router';
import { ENVIRONMENT, type Environment } from '@forepath/shared/frontend/util-configuration';
import { addPageMetaTags, buildPageMetaTags } from '@forepath/shared/frontend/util-meta';

export interface ForepathProduct {
  id: string;
  name: string;
  tagline: string;
  description: string;
  websiteUrl?: string;
  githubUrl?: string;
  status: 'available' | 'coming-soon';
}

@Component({
  selector: 'framework-forepath-one',
  imports: [CommonModule, RouterModule],
  styleUrls: ['./one.component.scss'],
  templateUrl: './one.component.html',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ForepathOneComponent implements OnInit {
  private readonly titleService = inject(Title);
  private readonly metaService = inject(Meta);
  private readonly environment = inject<Environment>(ENVIRONMENT);
  private readonly locale = inject(LOCALE_ID);
  private readonly destroyRef = inject(DestroyRef);

  readonly products: ForepathProduct[] = [
    {
      id: 'agenstra',
      name: 'Agenstra',
      tagline: 'Governance for coding agents at scale',
      description:
        'Centralized control for distributed AI agent infrastructure. Manage workspaces, tickets, coding environments, releases, and audit trails on infrastructure you own.',
      websiteUrl: 'https://agenstra.com',
      githubUrl: 'https://github.com/forepath/one',
      status: 'available',
    },
    {
      id: 'more',
      name: 'More products coming',
      tagline: 'Built the same way we advise clients',
      description:
        'ForePath One will grow with products we operate in production. We build focused tools for platform teams, not feature bloat.',
      status: 'coming-soon',
    },
  ];

  ngOnInit(): void {
    const metaTitle = $localize`:@@featureForepathOne-metaTitle:ForePath One services and products :: ForePath`;
    const metaDescription = $localize`:@@featureForepathOne-metaDescription:See how ForePath consulting, IT systems, software development, and ForePath One products connect. One thread from strategy to software you can operate.`;

    this.titleService.setTitle(metaTitle);
    this.destroyRef.onDestroy(
      addPageMetaTags(
        this.metaService,
        buildPageMetaTags({
          description: metaDescription,
          keywords: $localize`:@@featureForepathOne-metaKeywords:ForePath One, consulting, IT systems, software development, Agenstra, platform services`,
          author: 'IPvX UG (haftungsbeschränkt)',
          robots: 'index, follow',
          canonicalUrl: 'https://forepath.io/one',
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
