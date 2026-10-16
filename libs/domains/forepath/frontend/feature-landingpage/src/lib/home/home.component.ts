import { CommonModule, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, LOCALE_ID, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Meta, Title } from '@angular/platform-browser';
import { RouterModule } from '@angular/router';
import { ENVIRONMENT, type EnvironmentWithLandingAndCommunication } from '@forepath/shared/frontend/util-configuration';
import {
  SharedContactPersonComponent,
  SharedLogoGridComponent,
  type SharedLogoGridLogo,
} from '@forepath/shared/frontend/feature-landingpage';
import { addPageMetaTags, buildPageMetaTags } from '@forepath/shared/frontend/util-meta';
import { FpcBadgeComponent, FpcButtonComponent } from '@forepath/shared/frontend/ui-components';
import { catchError, of } from 'rxjs';

import { GhostContentApiService } from '../blog/ghost-content-api.service';
import type { GhostPost } from '../blog/ghost.types';
import { PlatformBoardIllustrationComponent } from '../illustrations/platform-board-illustration.component';

const PLATFORM_LOGO_SLOTS: readonly (readonly SharedLogoGridLogo[])[] = [
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
  imports: [
    SharedContactPersonComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    CommonModule,
    RouterModule,
    DatePipe,
    SharedLogoGridComponent,
    PlatformBoardIllustrationComponent,
  ],
  styleUrls: ['./home.component.scss'],
  templateUrl: './home.component.html',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ForepathHomeComponent implements OnInit {
  protected readonly logoSlots = PLATFORM_LOGO_SLOTS;
  readonly latestBlogPost = signal<GhostPost | null>(null);

  private readonly titleService = inject(Title);
  private readonly metaService = inject(Meta);
  private readonly environment = inject<EnvironmentWithLandingAndCommunication>(ENVIRONMENT);
  private readonly locale = inject(LOCALE_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly ghostApi = inject(GhostContentApiService);

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
          socialImageUrl: this.environment.socialPreview.urls.image,
          localeId: this.locale,
          localizeCanonicalUrl: this.environment.application.production,
        }),
      ),
    );

    this.loadLatestBlogPost();
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
}
