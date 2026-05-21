import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'framework-portal-desktop',
  imports: [CommonModule, RouterModule],
  styleUrls: ['./desktop.component.scss'],
  templateUrl: './desktop.component.html',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortalDesktopComponent implements OnInit {
  private readonly titleService = inject(Title);
  private readonly metaService = inject(Meta);

  ngOnInit(): void {
    this.titleService.setTitle(
      $localize`:@@featurePortalDesktop-metaTitle:Your local control center for AI agents :: Agenstra`,
    );
    this.metaService.addTags([
      {
        name: 'description',
        content: $localize`:@@featurePortalDesktop-metaDescription:Local control center for Agenstra: connect to your workspace, inspect agents, and manage context from the desktop app developers use every day.`,
      },
      {
        name: 'keywords',
        content:
          'Agenstra Desktop, AI agent desktop app, desktop client for AI agent management, local interface for AI agent orchestration, developer desktop app',
      },
      { name: 'author', content: 'IPvX UG (haftungsbeschränkt)' },
      { name: 'robots', content: 'index, follow' },
      { name: 'canonical', content: 'https://agenstra.com/desktop' },
    ]);
  }
}
