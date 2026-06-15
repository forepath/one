import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, LOCALE_ID, OnInit } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { ForepathOneTeaserComponent } from '../forepath-one-teaser/forepath-one-teaser.component';
import { ENVIRONMENT, type Environment } from '@forepath/shared/frontend/util-configuration';
import { addPageMetaTags, buildPageMetaTags } from '@forepath/shared/frontend/util-meta';

@Component({
  selector: 'framework-forepath-consulting',
  imports: [CommonModule, ForepathOneTeaserComponent],
  styleUrls: ['./consulting.component.scss'],
  templateUrl: './consulting.component.html',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ForepathConsultingComponent implements OnInit {
  private readonly titleService = inject(Title);
  private readonly metaService = inject(Meta);
  private readonly environment = inject<Environment>(ENVIRONMENT);
  private readonly locale = inject(LOCALE_ID);
  private readonly destroyRef = inject(DestroyRef);

  ngOnInit(): void {
    const metaTitle = $localize`:@@featureForepathConsulting-metaTitle:IT and platform consulting :: ForePath`;
    const metaDescription = $localize`:@@featureForepathConsulting-metaDescription:ForePath consulting for cloud platforms, DevOps, AI adoption, security, and compliance. Practical architecture and delivery guidance for engineering teams.`;

    this.titleService.setTitle(metaTitle);
    this.destroyRef.onDestroy(
      addPageMetaTags(
        this.metaService,
        buildPageMetaTags({
          description: metaDescription,
          keywords: $localize`:@@featureForepathConsulting-metaKeywords:ForePath consulting, cloud architecture, DevOps, AI consulting, security compliance, platform engineering`,
          author: 'IPvX UG (haftungsbeschränkt)',
          robots: 'index, follow',
          canonicalUrl: 'https://forepath.io/consulting',
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
