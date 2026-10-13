import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, LOCALE_ID, OnInit } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { RouterModule } from '@angular/router';
import { ENVIRONMENT, type EnvironmentWithLandingAndCommunication } from '@forepath/shared/frontend/util-configuration';
import { SharedLogoGridComponent, type SharedLogoGridLogo } from '@forepath/shared/frontend/feature-landingpage';
import { AgentctxIllustrationComponent } from '../illustrations/agentctx-illustration.component';
import { addPageMetaTags, buildPageMetaTags } from '@forepath/shared/frontend/util-meta';
import { FpcBadgeComponent, FpcButtonComponent } from '@forepath/shared/frontend/ui-components';

@Component({
  selector: 'framework-portal-agentctx',
  imports: [
    FpcBadgeComponent,
    FpcButtonComponent,
    CommonModule,
    RouterModule,
    SharedLogoGridComponent,
    AgentctxIllustrationComponent,
  ],
  styleUrls: ['./agentctx.component.scss'],
  templateUrl: './agentctx.component.html',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortalAgentCtxComponent implements OnInit {
  protected readonly assistantLogoSlots: readonly (readonly SharedLogoGridLogo[])[] = [
    [{ id: 'cursor', name: 'Cursor', logoUrl: 'assets/images/logos/cursor.svg' }],
    [{ id: 'opencode', name: 'OpenCode', logoUrl: 'assets/images/logos/opencode.svg' }],
    [{ id: 'github-copilot', name: 'GitHub Copilot', logoUrl: 'assets/images/logos/github-copilot.svg' }],
  ];

  private readonly titleService = inject(Title);
  private readonly metaService = inject(Meta);
  private readonly environment = inject<EnvironmentWithLandingAndCommunication>(ENVIRONMENT);
  private readonly locale = inject(LOCALE_ID);
  private readonly destroyRef = inject(DestroyRef);

  readonly installCommand = 'curl -fsSL https://downloads.agenstra.com/agentctx/install.sh | bash';
  readonly runCommand = 'agentctx';
  copyInstallFeedback = false;
  copyRunFeedback = false;

  ngOnInit(): void {
    const metaTitle = $localize`:@@featurePortalAgentctx-metaTitle:One context for all your AI coding tools :: Agenstra`;
    const metaDescription = $localize`:@@featurePortalAgentctx-metaDescription:Maintain project context once and generate aligned configs for Claude, Cursor, GitHub Copilot, and other AI coding tools your team already uses.`;

    this.titleService.setTitle(metaTitle);
    this.destroyRef.onDestroy(
      addPageMetaTags(
        this.metaService,
        buildPageMetaTags({
          description: metaDescription,
          keywords: $localize`:@@featurePortalAgentctx-metaKeywords:AgentCTX, agentctx, .agenstra, AI coding tools, Cursor, OpenCode, GitHub Copilot, agent context, rules, commands, skills, MCP, single source of truth`,
          author: 'IPvX UG (haftungsbeschränkt)',
          robots: 'index, follow',
          canonicalUrl: 'https://agenstra.com/agentctx',
          socialTitle: metaTitle,
          socialDescription: metaDescription,
          socialImageUrl: this.environment.socialPreview.urls.image,
          localeId: this.locale,
          localizeCanonicalUrl: this.environment.application.production,
        }),
      ),
    );
  }

  copyInstallCommand() {
    this.copyInstallFeedback = true;
    navigator.clipboard.writeText(this.installCommand);
  }

  copyRunCommand() {
    this.copyRunFeedback = true;
    navigator.clipboard.writeText(this.runCommand);
  }
}
