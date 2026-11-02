import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  model,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  apiErrorMessage,
  type AppManifest,
  AppStoreService,
  type CatalogAppVersion,
  type InstalledApp,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcButtonComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
} from '@forepath/shared/frontend/ui-components';

import { appPlanRoute, pendingMigrations, updateTargets } from './apps-format';

/**
 * Update an installed app (P1): the newer versions (installed channel first), what the plan does — applying it backs
 * up the volumes the target's declared backups name first (and applies only once they succeeded), then the target
 * manifest's migrations — and `POST …/update-plan`; the plan opens next.
 */
@Component({
  selector: 'loadweaver-app-update-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    FpcAlertComponent,
    FpcButtonComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
  ],
  template: `
    <fpc-modal [open]="open()" (openChange)="open.set($event)" [title]="title()">
      @if (app(); as a) {
        <p class="small mb-2">
          <span class="font-monospace">{{ a.project }}/{{ a.deployment }}</span>
          <span class="text-body-secondary"> · {{ a.app.version }} ({{ a.app.channel }})</span>
        </p>
        @if (loading()) {
          <p class="small text-body-secondary" data-testid="app-update-loading">{{ loadingLabel }}</p>
        } @else if (targets().length === 0) {
          <fpc-alert variant="info" [message]="noUpdateLabel" data-testid="app-update-none" />
        } @else {
          <fpc-form-field forId="lw-app-update-version" [label]="versionLabel">
            <fpc-form-control
              controlType="select"
              controlId="lw-app-update-version"
              size="sm"
              [ngModel]="version()"
              (ngModelChange)="setVersion($event)"
              data-testid="app-update-version"
            >
              @for (v of targets(); track v.version) {
                <option [value]="v.version">{{ v.version }} ({{ v.channel }})</option>
              }
            </fpc-form-control>
          </fpc-form-field>
          <fpc-alert variant="info" data-testid="app-update-notes">
            <div data-testid="app-update-backup">
              {{ targetManifest()?.backups?.length === 0 ? noBackupLabel : backupFirstLabel }}
            </div>
            @if (migrations().length > 0) {
              <div class="mt-1">{{ migrationsLabel }}</div>
              <ul class="mb-0 small">
                @for (m of migrations(); track m.version) {
                  <li>
                    <span class="font-monospace">{{ m.version }}</span>
                    @if (m.description) {
                      — {{ m.description }}
                    }
                    ({{ stepNames(m.steps) }})
                  </li>
                }
              </ul>
            } @else if (targetManifest()) {
              <div class="mt-1 small text-body-secondary">{{ noMigrationsLabel }}</div>
            }
          </fpc-alert>
        }
        @if (error(); as message) {
          <fpc-alert variant="danger" [message]="message" data-testid="app-update-error" />
        }
      }
      <div *fpcModalFooter class="d-flex justify-content-end gap-2">
        <fpc-button variant="secondary" (clicked)="open.set(false)">
          <span>{{ cancelLabel }}</span>
        </fpc-button>
        <fpc-button
          variant="primary"
          [disabled]="!version() || saving()"
          [loading]="saving()"
          (clicked)="submit()"
          data-testid="app-update-submit"
        >
          <i class="bi bi-file-diff me-1" aria-hidden="true"></i><span>{{ planLabel }}</span>
        </fpc-button>
      </div>
    </fpc-modal>
  `,
})
export class LoadweaverAppUpdateModalComponent {
  private readonly api = inject(AppStoreService);
  private readonly router = inject(Router);

  readonly open = model(false);
  readonly app = input<InstalledApp | null>(null);

  readonly versions = signal<CatalogAppVersion[]>([]);
  readonly version = signal('');
  readonly targetManifest = signal<AppManifest | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  /** Newer versions; the installed channel's first. */
  readonly targets = computed(() => {
    const a = this.app();

    if (!a) return [];

    const all = updateTargets(this.versions(), a.app.version);

    return [...all.filter((v) => v.channel === a.app.channel), ...all.filter((v) => v.channel !== a.app.channel)];
  });
  readonly migrations = computed(() => {
    const a = this.app();
    const m = this.targetManifest();

    return a && m && m.version === this.version() ? pendingMigrations(m, a.app.version) : [];
  });

  readonly title = computed(() => {
    const a = this.app();

    return a
      ? $localize`:@@lwConsoleApps-updateTitle:Update ${a.title ?? a.app.name}:app:`
      : $localize`:@@lwConsoleApps-update:Update`;
  });
  readonly versionLabel = $localize`:@@lwConsoleApps-targetVersion:Target version`;
  readonly backupFirstLabel = $localize`:@@lwConsoleApps-backupFirstApply:Applying the plan backs up the app's volumes first and updates the Deployment only once the backups succeeded. A failed backup fails the plan; nothing is changed.`;
  readonly noBackupLabel = $localize`:@@lwConsoleApps-noBackupFirst:The app declares no backups: the update is applied without a backup first.`;
  readonly migrationsLabel = $localize`:@@lwConsoleApps-migrations:Migrations that run in the plan:`;
  readonly noMigrationsLabel = $localize`:@@lwConsoleApps-noMigrations:No migrations for this update.`;
  readonly noUpdateLabel = $localize`:@@lwConsoleApps-noUpdate:No newer version is available.`;
  readonly loadingLabel = $localize`:@@lwConsoleApps-loadingVersions:Loading versions…`;
  readonly planLabel = $localize`:@@lwConsoleApps-createPlan:Create plan`;
  readonly cancelLabel = $localize`:@@lwConsoleApps-cancel:Cancel`;
  readonly failedLabel = $localize`:@@lwConsoleApps-updateFailed:The update plan couldn't be created.`;
  readonly detailFailedLabel = $localize`:@@lwConsoleApps-detailFailed:The app couldn't be loaded.`;

  readonly stepNames = (steps: { name: string }[]): string => steps.map((s) => s.name).join(', ');

  constructor() {
    effect(() => {
      const open = this.open();
      const app = this.app();

      if (open && app) untracked(() => this.load(app));
    });
  }

  private load(app: InstalledApp): void {
    this.versions.set([]);
    this.version.set('');
    this.targetManifest.set(null);
    this.error.set(null);
    this.loading.set(true);
    this.api.app(app.app.catalog, app.app.name).subscribe({
      next: (detail) => {
        this.versions.set(detail.versions ?? []);
        this.loading.set(false);

        const first = this.targets()[0];

        if (first) this.setVersion(first.version, detail.manifest);
      },
      error: (e: unknown) => {
        this.loading.set(false);
        this.error.set(apiErrorMessage(e, this.detailFailedLabel));
      },
    });
  }

  /** The target's manifest (its migrations); the latest's comes with the detail. */
  setVersion(version: string, known?: AppManifest): void {
    const app = this.app();

    this.version.set(version);

    if (known?.version === version) {
      this.targetManifest.set(known);

      return;
    }

    if (!app) return;

    this.api.app(app.app.catalog, app.app.name, version).subscribe({
      next: (detail) => {
        if (this.version() === version) this.targetManifest.set(detail.manifest);
      },
      error: () => undefined,
    });
  }

  submit(): void {
    const app = this.app();
    const version = this.version();

    if (!app || !version || this.saving()) return;

    this.saving.set(true);
    this.error.set(null);
    this.api.updatePlan(app.project, app.deployment, { version }).subscribe({
      next: (result) => {
        this.saving.set(false);
        this.open.set(false);
        void this.router.navigate(appPlanRoute(result) ?? ['/activity/plans']);
      },
      error: (e: unknown) => {
        this.saving.set(false);
        this.error.set(apiErrorMessage(e, this.failedLabel));
      },
    });
  }
}
