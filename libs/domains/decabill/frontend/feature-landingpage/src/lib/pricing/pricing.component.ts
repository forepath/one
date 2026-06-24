import { CommonModule, isPlatformBrowser } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  inject,
  LOCALE_ID,
  OnInit,
  PLATFORM_ID,
  signal,
  ViewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Meta, Title } from '@angular/platform-browser';
import { RouterModule } from '@angular/router';
import { ServicePlansFacade } from '@forepath/decabill/frontend/data-access-portal';
import { ENVIRONMENT, type Environment } from '@forepath/shared/frontend/util-configuration';
import { addPageMetaTags, buildPageMetaTags, formatProductMetaTitle } from '@forepath/shared/frontend/util-meta';

@Component({
  selector: 'framework-portal-pricing',
  imports: [CommonModule, RouterModule],
  styleUrls: ['./pricing.component.scss'],
  templateUrl: './pricing.component.html',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortalPricingComponent implements OnInit, AfterViewInit {
  private readonly titleService = inject(Title);
  private readonly metaService = inject(Meta);
  private readonly environment = inject<Environment>(ENVIRONMENT);
  private readonly servicePlansFacade = inject(ServicePlansFacade);
  private readonly locale = inject(LOCALE_ID);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild('pricingCarousel') pricingCarousel!: ElementRef<HTMLDivElement>;
  @ViewChild('enterpriseCard') enterpriseCard!: ElementRef<HTMLDivElement>;

  isLastCardVisible = signal<boolean>(true);

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

    const pageTitle = $localize`:@@featureDecabillPricing-metaTitlePage:Licensing from open source to enterprise`;
    const metaTitle = formatProductMetaTitle(pageTitle, this.environment.productName);
    const metaDescription = $localize`:@@featureDecabillPricing-metaDescription:Compare open-source, team, and enterprise Decabill plans. Flexible licensing for self-hosted or cloud deployments, with scale and compliance when you need it.`;

    this.titleService.setTitle(metaTitle);
    this.destroyRef.onDestroy(
      addPageMetaTags(
        this.metaService,
        buildPageMetaTags({
          description: metaDescription,
          keywords: $localize`:@@featureDecabillPricing-metaKeywords:Decabill pricing, billing platform pricing, subscription billing, self-hosted billing, enterprise billing platform`,
          author: 'IPvX UG (haftungsbeschränkt)',
          robots: 'index, follow',
          canonicalUrl: 'https://decabill.com/pricing',
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

  ngAfterViewInit(): void {
    if (isPlatformBrowser(this.platformId) && this.pricingCarousel.nativeElement) {
      this.pricingCarousel.nativeElement.scrollBy({
        left: this.enterpriseCard.nativeElement.offsetLeft,
        behavior: 'smooth',
      });
    }
  }

  scrollPricingCarousel(direction: 'left' | 'right'): void {
    if (isPlatformBrowser(this.platformId) && this.pricingCarousel.nativeElement) {
      if (direction === 'left') {
        this.isLastCardVisible.set(false);
      } else {
        this.isLastCardVisible.set(true);
      }

      this.pricingCarousel.nativeElement.scrollBy({
        left:
          direction === 'left'
            ? -this.enterpriseCard.nativeElement.offsetLeft
            : this.enterpriseCard.nativeElement.offsetLeft,
        behavior: 'smooth',
      });
    }
  }

  @HostListener('window:resize')
  onResize(): void {
    if (isPlatformBrowser(this.platformId) && this.pricingCarousel.nativeElement) {
      this.isLastCardVisible.set(true);
      this.pricingCarousel.nativeElement.scrollBy({
        left: this.enterpriseCard.nativeElement.offsetLeft,
        behavior: 'smooth',
      });
    }
  }
}
