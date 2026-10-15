import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, LOCALE_ID, OnInit } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { RouterModule } from '@angular/router';

import { ForepathOneTeaserComponent } from '../forepath-one-teaser/forepath-one-teaser.component';
import { CodeIllustrationComponent } from '../illustrations/code-illustration.component';
import { ENVIRONMENT, type EnvironmentWithLandingAndCommunication } from '@forepath/shared/frontend/util-configuration';
import { addPageMetaTags, buildPageMetaTags } from '@forepath/shared/frontend/util-meta';
import { FpcButtonComponent } from '@forepath/shared/frontend/ui-components';

@Component({
  selector: 'framework-forepath-software-development',
  imports: [FpcButtonComponent, CommonModule, RouterModule, ForepathOneTeaserComponent, CodeIllustrationComponent],
  styleUrls: ['./software-development.component.scss'],
  templateUrl: './software-development.component.html',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ForepathSoftwareDevelopmentComponent implements OnInit {
  // The stack from the user-facing layer down to the platform it runs on.
  readonly stackLayers = [
    {
      id: 'interface',
      label: $localize`:@@featureForepathSoftwareDevelopment-stackLayerInterface:Interface`,
      technologies: [
        { id: 'angular', name: 'Angular', logoUrl: 'assets/images/logos/angular.svg' },
        { id: 'vuedotjs', name: 'Vue.js', logoUrl: 'assets/images/logos/vuedotjs.svg' },
      ],
    },
    {
      id: 'services',
      label: $localize`:@@featureForepathSoftwareDevelopment-stackLayerServices:Services`,
      technologies: [
        { id: 'laravel', name: 'Laravel', logoUrl: 'assets/images/logos/laravel.svg' },
        { id: 'nestjs', name: 'NestJS', logoUrl: 'assets/images/logos/nestjs.svg' },
      ],
    },
    {
      id: 'data',
      label: $localize`:@@featureForepathSoftwareDevelopment-stackLayerData:Data`,
      technologies: [
        { id: 'postgresql', name: 'PostgreSQL', logoUrl: 'assets/images/logos/postgresql.svg' },
        { id: 'opensearch', name: 'OpenSearch', logoUrl: 'assets/images/logos/opensearch.svg' },
        { id: 'influxdb', name: 'InfluxDB', logoUrl: 'assets/images/logos/influxdb.svg' },
      ],
    },
    {
      id: 'platform',
      label: $localize`:@@featureForepathSoftwareDevelopment-stackLayerPlatform:Platform`,
      technologies: [
        { id: 'docker', name: 'Docker', logoUrl: 'assets/images/logos/docker.svg' },
        { id: 'kubernetes', name: 'Kubernetes', logoUrl: 'assets/images/logos/kubernetes.svg' },
        { id: 'proxmox', name: 'Proxmox', logoUrl: 'assets/images/logos/proxmox-icon.svg' },
      ],
    },
  ] as const;

  readonly buildCapabilities = [
    {
      icon: 'bi-layers',
      title: $localize`:@@featureForepathSoftwareDevelopment-cap1Title:Internal platforms`,
      description: $localize`:@@featureForepathSoftwareDevelopment-cap1Desc:Developer portals, self-service environments, and workflow tools that reduce platform team bottlenecks.`,
    },
    {
      icon: 'bi-plug',
      title: $localize`:@@featureForepathSoftwareDevelopment-cap2Title:Integrations & APIs`,
      description: $localize`:@@featureForepathSoftwareDevelopment-cap2Desc:Connect ERP, CRM, identity, and observability systems with reliable sync and clear error handling.`,
    },
    {
      icon: 'bi-window',
      title: $localize`:@@featureForepathSoftwareDevelopment-cap3Title:Web applications`,
      description: $localize`:@@featureForepathSoftwareDevelopment-cap3Desc:Customer and partner-facing products with accessible UI, performance budgets, and secure defaults.`,
    },
    {
      icon: 'bi-arrow-repeat',
      title: $localize`:@@featureForepathSoftwareDevelopment-cap4Title:Modernization`,
      description: $localize`:@@featureForepathSoftwareDevelopment-cap4Desc:Incremental rewrites, strangler patterns, and module extraction without big-bang releases.`,
    },
    {
      icon: 'bi-stars',
      title: $localize`:@@featureForepathSoftwareDevelopment-cap5Title:AI-enabled features`,
      description: $localize`:@@featureForepathSoftwareDevelopment-cap5Desc:Agent-assisted workflows embedded in your products with guardrails and observability.`,
    },
    {
      icon: 'bi-clipboard-check',
      title: $localize`:@@featureForepathSoftwareDevelopment-cap6Title:Quality assurance`,
      description: $localize`:@@featureForepathSoftwareDevelopment-cap6Desc:Test automation, contract tests, and CI pipelines that catch regressions before production.`,
    },
  ] as const;

  private readonly titleService = inject(Title);
  private readonly metaService = inject(Meta);
  private readonly environment = inject<EnvironmentWithLandingAndCommunication>(ENVIRONMENT);
  private readonly locale = inject(LOCALE_ID);
  private readonly destroyRef = inject(DestroyRef);

  ngOnInit(): void {
    const metaTitle = $localize`:@@featureForepathSoftwareDevelopment-metaTitle:Software development services :: ForePath`;
    const metaDescription = $localize`:@@featureForepathSoftwareDevelopment-metaDescription:ForePath builds internal platforms, integrations, and customer-facing applications with maintainable code, clear ownership, and production-ready delivery practices.`;

    this.titleService.setTitle(metaTitle);
    this.destroyRef.onDestroy(
      addPageMetaTags(
        this.metaService,
        buildPageMetaTags({
          description: metaDescription,
          keywords: $localize`:@@featureForepathSoftwareDevelopment-metaKeywords:ForePath software development, platform engineering, integrations, custom applications`,
          author: 'IPvX UG (haftungsbeschränkt)',
          robots: 'index, follow',
          canonicalUrl: 'https://forepath.io/software-development',
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
