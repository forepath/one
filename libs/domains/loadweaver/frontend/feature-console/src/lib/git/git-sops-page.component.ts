import { Component, computed, inject, OnInit } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ConsoleGitFacade, sopsEncryptCommand } from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcButtonComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcInputGroupComponent,
  FpcPageHeaderComponent,
} from '@forepath/shared/frontend/ui-components';

/**
 * The cluster's SOPS age recipient (3.29; 3.38: its own Delivery sub-nav page instead of a panel under the Git list):
 * the public recipient and the command that encrypts a file for this cluster.
 */
@Component({
  selector: 'loadweaver-git-sops-page',
  standalone: true,
  imports: [
    FpcAlertComponent,
    FpcButtonComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcInputGroupComponent,
    FpcPageHeaderComponent,
  ],
  template: `
    <div class="fpc-page">
      <fpc-page-header [title]="title" />
      @if (error(); as message) {
        <fpc-alert [flush]="true" variant="danger" [message]="message" />
      }
      @if (!loaded()) {
        <fpc-empty-state [loading]="true" [title]="loadingLabel" />
      } @else if (unavailable()) {
        <fpc-empty-state
          icon="shield-lock"
          i18n-title="@@lwConsoleGit-sopsUnavailable"
          title="The SOPS recipient isn't available to you"
          data-testid="git-sops-unavailable"
        />
      } @else if (recipient(); as recipient) {
        <div class="flex-grow-1 overflow-auto min-h-0 px-3 py-2" data-testid="git-sops">
          <fpc-form-field
            forId="lw-git-sops-recipient"
            i18n-label="@@lwConsoleGit-sopsRecipient"
            label="Age recipient"
            [hint]="hint"
          >
            <fpc-input-group size="sm">
              <fpc-form-control
                controlId="lw-git-sops-recipient"
                size="sm"
                controlClass="font-monospace"
                readOnly
                [value]="recipient"
                data-testid="git-sops-recipient"
              />
              <fpc-button
                fpcInputGroupSuffix
                variant="dark"
                size="sm"
                (clicked)="copy(recipient)"
                iconOnly
                ariaLabel="Copy"
                i18n-ariaLabel="@@lwConsoleGit-sopsCopy"
                title="Copy"
                i18n-title="@@lwConsoleGit-sopsCopy"
              >
                <i class="bi bi-clipboard" aria-hidden="true"></i>
              </fpc-button>
            </fpc-input-group>
          </fpc-form-field>
          <fpc-form-field forId="lw-git-sops-command" i18n-label="@@lwConsoleGit-sopsCommand" label="Encrypt a file">
            <fpc-input-group size="sm">
              <fpc-form-control
                controlId="lw-git-sops-command"
                size="sm"
                controlClass="font-monospace"
                readOnly
                [value]="command() ?? ''"
                data-testid="git-sops-command"
              />
              <fpc-button
                fpcInputGroupSuffix
                variant="dark"
                size="sm"
                (clicked)="copy(command())"
                iconOnly
                ariaLabel="Copy"
                i18n-ariaLabel="@@lwConsoleGit-sopsCopyCommand"
                title="Copy"
                i18n-title="@@lwConsoleGit-sopsCopyCommand"
              >
                <i class="bi bi-clipboard" aria-hidden="true"></i>
              </fpc-button>
            </fpc-input-group>
          </fpc-form-field>
        </div>
      } @else {
        <fpc-empty-state icon="key" [title]="noneLabel" data-testid="git-sops-none" />
      }
    </div>
  `,
})
export class LoadweaverGitSopsPageComponent implements OnInit {
  private readonly facade = inject(ConsoleGitFacade);

  readonly recipient = toSignal(this.facade.sopsRecipient$, { initialValue: null });
  readonly loaded = toSignal(this.facade.sopsLoaded$, { initialValue: false });
  readonly error = toSignal(this.facade.sopsError$, { initialValue: null });
  readonly unavailable = toSignal(this.facade.sopsUnavailable$, { initialValue: false });
  readonly command = computed(() => {
    const recipient = this.recipient();

    return recipient ? sopsEncryptCommand(recipient) : null;
  });

  readonly title = $localize`:@@lwConsoleGit-sops:SOPS`;
  readonly loadingLabel = $localize`:@@lwConsoleGit-sopsLoading:Loading the SOPS recipient`;
  readonly hint = $localize`:@@lwConsoleGit-sopsHint:Encrypt secret files for this cluster with its age recipient; connections with SOPS enabled decrypt them during the sync. The recipient is public.`;
  readonly noneLabel = $localize`:@@lwConsoleGit-sopsNone:The cluster has no age identity yet: SOPS files fail the sync until it has one.`;

  ngOnInit(): void {
    this.facade.loadSopsRecipient();
  }

  copy(text: string | null | undefined): void {
    if (text) void navigator.clipboard?.writeText(text);
  }
}
