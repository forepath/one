import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'framework-portal-legal-privacy',
  imports: [CommonModule, RouterModule],
  styleUrls: ['./privacy.component.scss'],
  templateUrl: './privacy.component.html',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortalLegalPrivacyComponent implements OnInit {
  private readonly titleService = inject(Title);
  private readonly metaService = inject(Meta);

  ngOnInit(): void {
    this.titleService.setTitle($localize`:@@featurePortalPrivacy-metaTitle:Privacy Policy :: Agenstra`);
    this.metaService.addTags([
      {
        name: 'description',
        content: $localize`:@@featurePortalPrivacy-metaDescription:How Agenstra and IPvX process personal data when you use our platform, websites, and support. Cookies, retention, your rights, and how to contact us.`,
      },
      {
        name: 'keywords',
        content: $localize`:@@featurePortalPrivacy-metaKeywords:Agenstra, privacy policy, platform, distributed AI agent infrastructure`,
      },
      { name: 'author', content: 'IPvX UG (haftungsbeschränkt)' },
      { name: 'robots', content: 'index, follow' },
      { name: 'canonical', content: 'https://agenstra.com/legal/privacy' },
    ]);
  }
}
