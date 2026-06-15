import { CommonModule, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  LOCALE_ID,
  OnInit,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { ForepathOneTeaserComponent } from '../forepath-one-teaser/forepath-one-teaser.component';
import { ENVIRONMENT, type Environment } from '@forepath/framework/frontend/util-configuration';
import { addPageMetaTags, buildPageMetaTags } from '@forepath/framework/frontend/util-meta';

type SkeletonLineWidth = 'long' | 'medium' | 'short';

interface SkeletonLine {
  id: number;
  width: SkeletonLineWidth;
  indent: boolean;
}

const SKELETON_WIDTHS: readonly SkeletonLineWidth[] = ['long', 'medium', 'short'];

const SKELETON_LINE_PATTERN: ReadonlyArray<{ width: SkeletonLineWidth; indent?: boolean }> = [
  { width: 'medium' },
  { width: 'short' },
  { width: 'long' },
  { width: 'medium' },
  { width: 'short' },
  { width: 'long', indent: true },
  { width: 'medium', indent: true },
  { width: 'long' },
  { width: 'short' },
  { width: 'medium', indent: true },
  { width: 'long', indent: true },
  { width: 'medium' },
  { width: 'long', indent: true },
  { width: 'short', indent: true },
  { width: 'long' },
  { width: 'medium', indent: true },
  { width: 'long', indent: true },
  { width: 'short' },
  { width: 'medium' },
  { width: 'long', indent: true },
  { width: 'medium', indent: true },
  { width: 'long' },
  { width: 'short', indent: true },
  { width: 'medium' },
  { width: 'long', indent: true },
  { width: 'medium' },
  { width: 'long' },
  { width: 'short', indent: true },
  { width: 'medium', indent: true },
  { width: 'long', indent: true },
  { width: 'short' },
  { width: 'long' },
  { width: 'medium', indent: true },
  { width: 'short', indent: true },
  { width: 'long', indent: true },
  { width: 'medium' },
  { width: 'long' },
  { width: 'short', indent: true },
  { width: 'medium', indent: true },
  { width: 'long' },
  { width: 'medium' },
  { width: 'short' },
  { width: 'long', indent: true },
  { width: 'medium', indent: true },
  { width: 'long', indent: true },
  { width: 'short' },
  { width: 'medium' },
  { width: 'long' },
];

const SKELETON_LINE_LIMIT_XS = 10;
const SKELETON_LINE_LIMIT_MD = 18;
const SKELETON_LINE_LIMIT_LG = SKELETON_LINE_PATTERN.length;
const SKELETON_LANGUAGE_ROTATION_INTERVAL = 3;

interface SkeletonLanguage {
  id: 'php' | 'typescript' | 'java';
  label: string;
  badgeClass: string;
  logoUrl: string;
}

const SKELETON_LANGUAGES: readonly SkeletonLanguage[] = [
  { id: 'php', label: 'PHP', badgeClass: 'dev-code-skeleton__badge--php', logoUrl: 'assets/images/logos/php.svg' },
  {
    id: 'typescript',
    label: 'TypeScript',
    badgeClass: 'dev-code-skeleton__badge--typescript',
    logoUrl: 'assets/images/logos/typescript.svg',
  },
  { id: 'java', label: 'Java', badgeClass: 'dev-code-skeleton__badge--java', logoUrl: 'assets/images/logos/java.svg' },
];

@Component({
  selector: 'framework-forepath-software-development',
  imports: [CommonModule, ForepathOneTeaserComponent],
  styleUrls: ['./software-development.component.scss'],
  templateUrl: './software-development.component.html',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ForepathSoftwareDevelopmentComponent implements OnInit {
  readonly stackTechnologies = [
    { id: 'laravel', name: 'Laravel', logoUrl: 'assets/images/logos/laravel.svg' },
    { id: 'vuedotjs', name: 'Vue.js', logoUrl: 'assets/images/logos/vuedotjs.svg' },
    { id: 'angular', name: 'Angular', logoUrl: 'assets/images/logos/angular.svg' },
    { id: 'nestjs', name: 'NestJS', logoUrl: 'assets/images/logos/nestjs.svg' },
    { id: 'postgresql', name: 'PostgreSQL', logoUrl: 'assets/images/logos/postgresql.svg' },
    { id: 'kubernetes', name: 'Kubernetes', logoUrl: 'assets/images/logos/kubernetes.svg' },
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
      title: $localize`:@@featureForepathSoftwareDevelopment-cap6Title:Quality engineering`,
      description: $localize`:@@featureForepathSoftwareDevelopment-cap6Desc:Test automation, contract tests, and CI pipelines that catch regressions before production.`,
    },
  ] as const;

  readonly skeletonLines = signal<SkeletonLine[]>(
    SKELETON_LINE_PATTERN.map((line, index) => ({
      id: index,
      width: line.width,
      indent: line.indent ?? false,
    })),
  );

  readonly skeletonLineLimit = signal(SKELETON_LINE_LIMIT_LG);
  readonly visibleSkeletonLines = computed(() => this.skeletonLines().slice(0, this.skeletonLineLimit()));
  readonly activeSkeletonLanguageIndex = signal(0);
  readonly activeSkeletonLanguage = computed(() => SKELETON_LANGUAGES[this.activeSkeletonLanguageIndex()]);

  private readonly titleService = inject(Title);
  private readonly metaService = inject(Meta);
  private readonly environment = inject<Environment>(ENVIRONMENT);
  private readonly locale = inject(LOCALE_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private skeletonMutationTimeoutId: ReturnType<typeof setTimeout> | undefined;
  private skeletonMutationCount = 0;

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
          socialImageUrl: this.environment.socialPreview.imageUrl,
          localeId: this.locale,
          localizeCanonicalUrl: this.environment.production,
        }),
      ),
    );

    this.initResponsiveSkeletonLineLimit();
    this.startSkeletonLineMutations();
    this.destroyRef.onDestroy(() => {
      clearTimeout(this.skeletonMutationTimeoutId);
    });
  }

  private startSkeletonLineMutations(): void {
    if (!isPlatformBrowser(this.platformId) || this.prefersReducedMotion()) {
      return;
    }

    const scheduleNextMutation = (): void => {
      const delayMs = 1200 + Math.random() * 800;
      this.skeletonMutationTimeoutId = setTimeout(() => {
        this.mutateRandomSkeletonLineWidths();
        scheduleNextMutation();
      }, delayMs);
    };

    scheduleNextMutation();
  }

  private mutateRandomSkeletonLineWidths(): void {
    const lines = [...this.skeletonLines()];
    const visibleLimit = this.skeletonLineLimit();
    const changeCount = Math.min(6 + Math.floor(Math.random() * 7), Math.max(3, Math.floor(visibleLimit * 0.4)));
    const indices = new Set<number>();

    while (indices.size < changeCount && indices.size < visibleLimit) {
      indices.add(Math.floor(Math.random() * visibleLimit));
    }

    for (const index of indices) {
      const currentWidth = lines[index].width;
      const nextWidths = SKELETON_WIDTHS.filter((width) => width !== currentWidth);
      const nextWidth = nextWidths[Math.floor(Math.random() * nextWidths.length)];
      lines[index] = { ...lines[index], width: nextWidth };
    }

    this.skeletonLines.set(lines);
    this.skeletonMutationCount += 1;

    if (this.skeletonMutationCount % SKELETON_LANGUAGE_ROTATION_INTERVAL === 0) {
      this.activeSkeletonLanguageIndex.update((index) => (index + 1) % SKELETON_LANGUAGES.length);
    }
  }

  private initResponsiveSkeletonLineLimit(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    const updateLimit = (): void => {
      if (window.matchMedia('(min-width: 992px)').matches) {
        this.skeletonLineLimit.set(SKELETON_LINE_LIMIT_LG);
        return;
      }

      if (window.matchMedia('(min-width: 576px)').matches) {
        this.skeletonLineLimit.set(SKELETON_LINE_LIMIT_MD);
        return;
      }

      this.skeletonLineLimit.set(SKELETON_LINE_LIMIT_XS);
    };

    updateLimit();

    const mediaQueries = [window.matchMedia('(min-width: 576px)'), window.matchMedia('(min-width: 992px)')];
    const onChange = (): void => updateLimit();

    for (const mediaQuery of mediaQueries) {
      mediaQuery.addEventListener('change', onChange);
    }

    this.destroyRef.onDestroy(() => {
      for (const mediaQuery of mediaQueries) {
        mediaQuery.removeEventListener('change', onChange);
      }
    });
  }

  private prefersReducedMotion(): boolean {
    return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
}
