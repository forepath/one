import { CommonModule, DatePipe, isPlatformBrowser } from '@angular/common';
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
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Meta, Title } from '@angular/platform-browser';
import { RouterModule } from '@angular/router';
import { ENVIRONMENT, type Environment } from '@forepath/shared/frontend/util-configuration';
import { addPageMetaTags, buildPageMetaTags } from '@forepath/shared/frontend/util-meta';
import { FpcBadgeComponent, FpcButtonComponent } from '@forepath/shared/frontend/ui-components';
import { catchError, of } from 'rxjs';

import { GhostContentApiService } from '../blog/ghost-content-api.service';
import type { GhostPost } from '../blog/ghost.types';

interface PlatformLogo {
  id: string;
  name: string;
  logoUrl: string;
  compact?: boolean;
}

interface VisiblePlatformLogo extends PlatformLogo {
  instanceKey: string;
}

const PLATFORM_LOGO_ROTATION_INTERVAL_MS = 4000;

const PLATFORM_LOGO_SLOTS: readonly (readonly PlatformLogo[])[] = [
  [
    { id: 'fedora', name: 'Fedora', logoUrl: 'assets/images/logos/fedora.svg' },
    { id: 'redhat', name: 'Red Hat', logoUrl: 'assets/images/logos/redhat.svg' },
  ],
  [
    { id: 'ubuntu', name: 'Ubuntu', logoUrl: 'assets/images/logos/ubuntu.svg' },
    { id: 'windowsserver', name: 'Windows Server', logoUrl: 'assets/images/logos/windowsserver.svg' },
    { id: 'kubernetes', name: 'Kubernetes', logoUrl: 'assets/images/logos/kubernetes.svg' },
  ],
  [
    { id: 'aws', name: 'AWS', logoUrl: 'assets/images/logos/aws.svg' },
    { id: 'hetzner', name: 'Hetzner', logoUrl: 'assets/images/logos/hetzner.svg' },
  ],
  [
    { id: 'digitalocean', name: 'DigitalOcean', logoUrl: 'assets/images/logos/digitalocean.png' },
    { id: 'cloudflare', name: 'Cloudflare', logoUrl: 'assets/images/logos/cloudflare.svg' },
    { id: 'docker', name: 'Docker', logoUrl: 'assets/images/logos/docker.png' },
  ],
] as const;

@Component({
  selector: 'framework-forepath-home',
  imports: [FpcBadgeComponent, FpcButtonComponent, CommonModule, RouterModule, DatePipe],
  styleUrls: ['./home.component.scss'],
  templateUrl: './home.component.html',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ForepathHomeComponent implements OnInit {
  readonly platformSlotIndices = signal([0, 0, 0, 0]);
  readonly visiblePlatformLogos = computed<VisiblePlatformLogo[]>(() =>
    this.platformSlotIndices().map((index, slotIndex) => {
      const logo = PLATFORM_LOGO_SLOTS[slotIndex][index];
      return {
        ...logo,
        instanceKey: `${slotIndex}-${logo.id}-${index}`,
      };
    }),
  );
  readonly latestBlogPost = signal<GhostPost | null>(null);

  private readonly titleService = inject(Title);
  private readonly metaService = inject(Meta);
  private readonly environment = inject<Environment>(ENVIRONMENT);
  private readonly locale = inject(LOCALE_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly ghostApi = inject(GhostContentApiService);
  private platformLogoRotationIntervalId: ReturnType<typeof setInterval> | undefined;

  ngOnInit(): void {
    const metaTitle = $localize`:@@featureForepathHome-metaTitle:Consulting and engineering for modern IT :: ForePath`;
    const metaDescription = $localize`:@@featureForepathHome-metaDescription:ForePath helps organizations design infrastructure, deliver software, and adopt AI with practical engineering, open standards, and systems you can operate long term.`;

    this.titleService.setTitle(metaTitle);
    this.destroyRef.onDestroy(
      addPageMetaTags(
        this.metaService,
        buildPageMetaTags({
          description: metaDescription,
          keywords: $localize`:@@featureForepathHome-metaKeywords:ForePath, IT consulting, cloud infrastructure, DevOps, software development, digital sovereignty, Germany`,
          author: 'IPvX UG (haftungsbeschränkt)',
          robots: 'index, follow',
          canonicalUrl: 'https://forepath.io',
          socialTitle: metaTitle,
          socialDescription: metaDescription,
          socialImageUrl: this.environment.socialPreview.imageUrl,
          localeId: this.locale,
          localizeCanonicalUrl: this.environment.production,
        }),
      ),
    );

    this.loadLatestBlogPost();
    this.startPlatformLogoRotation();
    this.destroyRef.onDestroy(() => {
      clearInterval(this.platformLogoRotationIntervalId);
    });
  }

  private loadLatestBlogPost(): void {
    this.ghostApi
      .browsePosts({ page: 1, limit: 1 })
      .pipe(
        catchError(() => of(null)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result) => {
        this.latestBlogPost.set(result?.posts[0] ?? null);
      });
  }

  private startPlatformLogoRotation(): void {
    if (!isPlatformBrowser(this.platformId) || this.prefersReducedMotion()) {
      return;
    }

    this.platformLogoRotationIntervalId = setInterval(() => {
      this.platformSlotIndices.update((indices) =>
        indices.map((index, slotIndex) => (index + 1) % PLATFORM_LOGO_SLOTS[slotIndex].length),
      );
    }, PLATFORM_LOGO_ROTATION_INTERVAL_MS);
  }

  private prefersReducedMotion(): boolean {
    return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
}
