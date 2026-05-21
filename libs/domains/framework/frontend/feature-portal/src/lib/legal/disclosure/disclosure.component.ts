import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'framework-portal-legal-disclosure',
  imports: [CommonModule, RouterModule],
  styleUrls: ['./disclosure.component.scss'],
  templateUrl: './disclosure.component.html',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortalLegalDisclosureComponent implements OnInit {
  private readonly titleService = inject(Title);
  private readonly metaService = inject(Meta);

  ngOnInit(): void {
    this.titleService.setTitle($localize`:@@featurePortalDisclosure-metaTitle:Legal Disclosure :: Agenstra`);
    this.metaService.addTags([
      {
        name: 'description',
        content: $localize`:@@featurePortalDisclosure-metaDescription:Imprint and legal disclosure for Agenstra by IPvX UG (haftungsbeschränkt). Company details, representation, and regulatory information for Germany.`,
      },
      {
        name: 'keywords',
        content: $localize`:@@featurePortalDisclosure-metaKeywords:Agenstra, legal disclosure, platform, distributed AI agent infrastructure`,
      },
      { name: 'author', content: 'IPvX UG (haftungsbeschränkt)' },
      { name: 'robots', content: 'index, follow' },
      { name: 'canonical', content: 'https://agenstra.com/legal/disclosure' },
    ]);
  }
}
