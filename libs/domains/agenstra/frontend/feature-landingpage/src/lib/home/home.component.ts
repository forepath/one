import { CommonModule, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  LOCALE_ID,
  OnInit,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Meta, Title } from '@angular/platform-browser';
import { RouterModule } from '@angular/router';
import type { PublicServicePlanOffering } from '@forepath/agenstra/frontend/data-access-portal';
import { formatPublicOfferingPrice, ServicePlansFacade } from '@forepath/agenstra/frontend/data-access-portal';
import { ENVIRONMENT, type Environment } from '@forepath/shared/frontend/util-configuration';
import { addPageMetaTags, buildPageMetaTags } from '@forepath/shared/frontend/util-meta';

@Component({
  selector: 'framework-portal-home',
  imports: [CommonModule, RouterModule],
  styleUrls: ['./home.component.scss'],
  templateUrl: './home.component.html',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortalHomeComponent implements OnInit {
  private readonly titleService = inject(Title);
  private readonly metaService = inject(Meta);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly servicePlansFacade = inject(ServicePlansFacade);
  private readonly environment = inject<Environment>(ENVIRONMENT);
  private readonly locale = inject(LOCALE_ID);
  private readonly destroyRef = inject(DestroyRef);

  activeSlide = signal<number>(1);
  autoplayInterval = this.initializeAutoplayInterval();

  readonly cheapestOffering = toSignal(this.servicePlansFacade.getCheapestServicePlanOffering$(), {
    initialValue: null,
  });

  readonly cheapestOfferingLoading = toSignal(this.servicePlansFacade.getCheapestServicePlanOfferingLoading$(), {
    initialValue: false,
  });

  readonly cheapestLoaded = toSignal(this.servicePlansFacade.getCheapestServicePlanOfferingLoaded$(), {
    initialValue: false,
  });

  readonly billingBaseUrl = this.environment.production
    ? `${this.environment.billing.frontendUrl}/${this.locale}/subscriptions?order=true`
    : `${this.environment.billing.frontendUrl}/subscriptions?order=true`;

  ngOnInit(): void {
    this.servicePlansFacade.loadCheapestServicePlanOffering();
    const metaTitle = $localize`:@@featurePortalHome-metaTitle:One place to run, govern, and ship with agents :: Agenstra`;
    const metaDescription = $localize`:@@featurePortalHome-metaDescription:Run and govern coding agents at enterprise scale: workspaces, ticket automation, in-browser coding, releases, policy, and audit trails. Self-host Agenstra or run on Agenstra Cloud.`;

    this.titleService.setTitle(metaTitle);
    this.destroyRef.onDestroy(
      addPageMetaTags(
        this.metaService,
        buildPageMetaTags({
          description: metaDescription,
          keywords: $localize`:@@featurePortalHome-metaKeywords:Agenstra, enterprise coding agents, AI agent governance, ticket automation, agent audit, self-hosted AI platform, software delivery, team knowledge, Cursor OpenCode integration`,
          author: 'IPvX UG (haftungsbeschränkt)',
          robots: 'index, follow',
          canonicalUrl: 'https://agenstra.com',
          socialTitle: metaTitle,
          socialDescription: metaDescription,
          socialImageUrl: this.environment.socialPreview.imageUrl,
          localeId: this.locale,
          localizeCanonicalUrl: this.environment.production,
        }),
      ),
    );
  }

  scrollToIntent(event: MouseEvent) {
    const target = event.target as HTMLElement;
    const rect = target.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const slideWidth = rect.width / 4;
    let slideNum = Math.floor(clickX / slideWidth) + 1;

    slideNum = Math.max(1, Math.min(4, slideNum));
    this.activeSlide.set(slideNum);
  }

  pauseAutoplay() {
    if (this.autoplayInterval) {
      clearInterval(this.autoplayInterval);
    }

    this.autoplayInterval = null;
  }

  resumeAutoplay() {
    this.autoplayInterval = this.initializeAutoplayInterval();
  }

  private initializeAutoplayInterval() {
    if (isPlatformBrowser(this.platformId)) {
      return setInterval(() => {
        this.activeSlide.update((prev) => prev + 1);

        if (this.activeSlide() > 4) {
          this.activeSlide.set(1);
        }
      }, 3000);
    }

    return null;
  }

  billingIntervalSuffix(plan: PublicServicePlanOffering): string {
    if (plan.billingIntervalType === 'month' && plan.billingIntervalValue === 1) {
      return $localize`:@@featurePortalCloud-planPriceMonth:/month`;
    }

    if (plan.billingIntervalType === 'hour') {
      return $localize`:@@featurePortalCloud-planPriceHour:/hour`;
    }

    if (plan.billingIntervalType === 'day') {
      return $localize`:@@featurePortalCloud-planPriceDay:/day`;
    }

    return ` / ${plan.billingIntervalValue} ${plan.billingIntervalType}`;
  }

  formatPublicOfferingPrice = formatPublicOfferingPrice;
}
