import { CommonModule, isPlatformBrowser } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  inject,
  OnInit,
  PLATFORM_ID,
  signal,
  ViewChild,
} from '@angular/core';
import { RouterModule } from '@angular/router';
import { SharedContactPersonComponent } from '@forepath/shared/frontend/feature-landingpage';
import { FpcBadgeComponent, FpcButtonComponent } from '@forepath/shared/frontend/ui-components';

import {
  LOADWEAVER_CLOUD_EARLY_ACCESS_MESSAGE,
  LOADWEAVER_EARLY_ACCESS_MESSAGE,
  LoadweaverEarlyAccessDirective,
} from '../shared/early-access';
import { injectPageMeta } from '../shared/page-meta';

@Component({
  selector: 'loadweaver-portal-pricing',
  imports: [
    CommonModule,
    RouterModule,
    FpcBadgeComponent,
    FpcButtonComponent,
    SharedContactPersonComponent,
    LoadweaverEarlyAccessDirective,
  ],
  styleUrls: ['./pricing.component.scss'],
  templateUrl: './pricing.component.html',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortalPricingComponent implements OnInit, AfterViewInit {
  protected readonly cloudEarlyAccessMessage = LOADWEAVER_CLOUD_EARLY_ACCESS_MESSAGE;
  protected readonly enterpriseMessage = $localize`:@@featureLoadweaverPricing-enterprisePrefill:Hi, I am interested in Loadweaver Enterprise. Please get in touch about support, an SLA and licensing.`;
  protected readonly earlyAccessMessage = LOADWEAVER_EARLY_ACCESS_MESSAGE;

  private readonly setPageMeta = injectPageMeta();
  private readonly platformId = inject(PLATFORM_ID);

  @ViewChild('pricingCarousel') pricingCarousel!: ElementRef<HTMLDivElement>;
  @ViewChild('enterpriseCard') enterpriseCard!: ElementRef<HTMLDivElement>;

  /** Tier carousel (same as Agenstra's pricing page): three tiers visible on large screens, arrows shift by one. */
  readonly isLastCardVisible = signal<boolean>(true);

  ngOnInit(): void {
    this.setPageMeta({
      title: $localize`:@@featureLoadweaverPricing-metaTitle:Licensing from open source to enterprise :: Loadweaver`,
      description: $localize`:@@featureLoadweaverPricing-metaDescription:Loadweaver licensing: a full single-site cluster as AGPL-3.0 open source, multi-site under BUSL-1.1 (free below €2M total finances), Business at a flat €499 per month, Enterprise on request and the managed Loadweaver Cloud.`,
      keywords: $localize`:@@featureLoadweaverPricing-metaKeywords:Loadweaver pricing, Loadweaver license, AGPL, BUSL, open source cluster, high availability pricing`,
      path: '/pricing',
    });
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
      this.isLastCardVisible.set(direction === 'right');
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
