import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, LOCALE_ID, OnInit } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { RouterModule } from '@angular/router';
import { ENVIRONMENT, type EnvironmentWithLandingAndCommunication } from '@forepath/shared/frontend/util-configuration';
import { SharedLogoGridComponent, type SharedLogoGridLogo } from '@forepath/shared/frontend/feature-landingpage';
import { addPageMetaTags, buildPageMetaTags } from '@forepath/shared/frontend/util-meta';
import { FpcButtonComponent } from '@forepath/shared/frontend/ui-components';

import { EvolutionIllustrationComponent } from '../illustrations/evolution-illustration.component';
import { FOREPATH_DISTRIBUTOR_LOGOS } from '../it-systems/services/it-systems-services';

interface AboutMilestone {
  id: string;
  /** ISO date (or year) for `<time datetime>`; omitted for upcoming milestones. */
  datetime?: string;
  date: string;
  icon: string;
  title: string;
  description: string;
  link?: { label: string; href: string };
  /** Where ForePath stands today: highlighted in the timeline. */
  current?: boolean;
  /** Announced but not released yet: drawn dashed, without a date. */
  upcoming?: boolean;
}

const PARTNER_LOGO_SLOTS: readonly (readonly SharedLogoGridLogo[])[] = [
  ...FOREPATH_DISTRIBUTOR_LOGOS.map((logo) => [logo]),
  [{ id: 'topi', name: 'topi', logoUrl: 'assets/images/logos/topi.svg' }],
];

@Component({
  selector: 'framework-forepath-about',
  imports: [FpcButtonComponent, CommonModule, RouterModule, SharedLogoGridComponent, EvolutionIllustrationComponent],
  styleUrls: ['./about.component.scss'],
  templateUrl: './about.component.html',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ForepathAboutComponent implements OnInit {
  protected readonly partnerSlots = PARTNER_LOGO_SLOTS;
  protected readonly ceoLinkedInUrl = 'https://www.linkedin.com/in/marcel-menk/';

  // The company story, oldest first.
  protected readonly milestones: readonly AboutMilestone[] = [
    {
      id: 'founding',
      datetime: '2016-06-22',
      date: $localize`:@@featureForepathAbout-milestoneFoundingDate:June 2016`,
      icon: 'bi-flag',
      title: $localize`:@@featureForepathAbout-milestoneFoundingTitle:Founded as a sole proprietorship`,
      description: $localize`:@@featureForepathAbout-milestoneFoundingDesc:IT systems and software development from the very first day, for clients who wanted one partner for both.`,
    },
    {
      id: 'ug',
      datetime: '2022-02-22',
      date: $localize`:@@featureForepathAbout-milestoneUgDate:February 2022`,
      icon: 'bi-building',
      title: $localize`:@@featureForepathAbout-milestoneUgTitle:Re-formed as IPvX UG (haftungsbeschränkt)`,
      description: $localize`:@@featureForepathAbout-milestoneUgDesc:A limited company as the foundation for longer engagements and growth, with the same services and the same people behind them.`,
    },
    {
      id: 'vmmx',
      datetime: '2023-05-26',
      date: $localize`:@@featureForepathAbout-milestoneVmmxDate:May 2023`,
      icon: 'bi-cloud',
      title: $localize`:@@featureForepathAbout-milestoneVmmxTitle:Co-founded VMMX Cloud GmbH`,
      description: $localize`:@@featureForepathAbout-milestoneVmmxDesc:Together with the hosting provider dataforest GmbH, we founded VMMX to make scalable app hosting on Kubernetes simple for European companies, with one-click deployments from a data centre in Frankfurt.`,
    },
    {
      id: 'garage33',
      datetime: '2024-06-26',
      date: $localize`:@@featureForepathAbout-milestoneGarage33Date:June 2024`,
      icon: 'bi-trophy',
      title: $localize`:@@featureForepathAbout-milestoneGarage33Title:VMMX wins at garage33`,
      description: $localize`:@@featureForepathAbout-milestoneGarage33Desc:VMMX went through the garage33 incubator in Paderborn and came out on top. The program sharpened our product thinking and showed us what young companies need from their infrastructure.`,
    },
    {
      id: 'obms-kublade',
      datetime: '2025-07-17',
      date: $localize`:@@featureForepathAbout-milestoneOpenSourceDate:July 2025`,
      icon: 'bi-github',
      title: $localize`:@@featureForepathAbout-milestoneOpenSourceTitle:OBMS and Kublade released as open source`,
      description: $localize`:@@featureForepathAbout-milestoneOpenSourceDesc:We published two of our tools under the Apache 2.0 licence. OBMS is an ERP system for digital business models, and Kublade is a templating engine for Kubernetes deployments.`,
      link: { label: 'github.com/forepath', href: 'https://github.com/forepath' },
    },
    {
      id: 'agenstra',
      datetime: '2025-11',
      date: $localize`:@@featureForepathAbout-milestoneAgenstraDate:November 2025`,
      icon: 'bi-robot',
      title: $localize`:@@featureForepathAbout-milestoneAgenstraTitle:Agenstra released`,
      description: $localize`:@@featureForepathAbout-milestoneAgenstraDesc:Our first product: a platform to run and ship with coding agents on infrastructure you control, built in the open.`,
      link: { label: 'agenstra.com', href: 'https://agenstra.com' },
    },
    {
      id: 'decabill',
      datetime: '2026-06',
      date: $localize`:@@featureForepathAbout-milestoneDecabillDate:June 2026`,
      icon: 'bi-receipt',
      title: $localize`:@@featureForepathAbout-milestoneDecabillTitle:Decabill released`,
      description: $localize`:@@featureForepathAbout-milestoneDecabillDesc:OBMS and Kublade grow together into Decabill, our billing platform for services and SaaS, from cloud usage and projects to invoices and DATEV exports.`,
      link: { label: 'decabill.com', href: 'https://decabill.com' },
    },
    {
      id: 'focus',
      datetime: '2026-10-12',
      date: $localize`:@@featureForepathAbout-milestoneFocusDate:October 2026`,
      icon: 'bi-bullseye',
      title: $localize`:@@featureForepathAbout-milestoneFocusTitle:Full focus on ForePath`,
      description: $localize`:@@featureForepathAbout-milestoneFocusDesc:Today ForePath has our full attention, with AI at the centre, while our VMMX partners return to their own core business. It was a great time. However, we collectively decided not to continue VMMX. In its place, you can look forward to something great from ForePath, built on everything VMMX taught us.`,
      current: true,
    },
    {
      id: 'loadweaver',
      date: $localize`:@@featureForepathAbout-milestoneLoadweaverDate:Early access`,
      icon: 'bi-diagram-3',
      title: $localize`:@@featureForepathAbout-milestoneLoadweaverTitle:Loadweaver`,
      description: $localize`:@@featureForepathAbout-milestoneLoadweaverDesc:Our next product turns a handful of servers into a resilient multi-site cluster. It gives applications built with AI, and the agents behind them, a protected home on infrastructure you control, with encrypted traffic between sites and services that keep running when a location goes down.`,
      link: { label: 'loadweaver.com', href: 'https://loadweaver.com' },
      upcoming: true,
    },
  ];

  private readonly titleService = inject(Title);
  private readonly metaService = inject(Meta);
  private readonly environment = inject<EnvironmentWithLandingAndCommunication>(ENVIRONMENT);
  private readonly locale = inject(LOCALE_ID);
  private readonly destroyRef = inject(DestroyRef);

  ngOnInit(): void {
    const metaTitle = $localize`:@@featureForepathAbout-metaTitle:About us :: ForePath`;
    const metaDescription = $localize`:@@featureForepathAbout-metaDescription:Since 2016, ForePath has planned, built, and operated IT systems and software for businesses. Our story, our principles, and the people behind ForePath.`;

    this.titleService.setTitle(metaTitle);
    this.destroyRef.onDestroy(
      addPageMetaTags(
        this.metaService,
        buildPageMetaTags({
          description: metaDescription,
          keywords: $localize`:@@featureForepathAbout-metaKeywords:ForePath, about us, IPvX UG, company history, Herford, Ostwestfalen-Lippe, IT systems, software development`,
          author: 'IPvX UG (haftungsbeschränkt)',
          robots: 'index, follow',
          canonicalUrl: 'https://forepath.io/about',
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
