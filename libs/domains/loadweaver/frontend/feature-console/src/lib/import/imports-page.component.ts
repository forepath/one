import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterModule } from '@angular/router';
import { apiErrorMessage, ImportService, type ImportSummary } from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcEmptyStateComponent,
  FpcListComponent,
  FpcListItemComponent,
  FpcPageHeaderComponent,
  FpcSpinnerComponent,
} from '@forepath/shared/frontend/ui-components';

import { STATUS_TONE } from './import-format';

/** Hosts that joined for an import (3.21): discovered, waiting for or running their join plan. */
@Component({
  selector: 'loadweaver-imports-page',
  imports: [
    CommonModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcEmptyStateComponent,
    FpcListComponent,
    FpcListItemComponent,
    FpcPageHeaderComponent,
    FpcSpinnerComponent,
  ],
  templateUrl: './imports-page.component.html',
  standalone: true,
})
export class LoadweaverImportsPageComponent implements OnInit {
  private readonly service = inject(ImportService);

  readonly title = $localize`:@@lwConsoleImport-listTitle:Import hosts`;
  readonly imports = signal<ImportSummary[] | null>(null);
  readonly error = signal<string | null>(null);
  readonly statusTone = STATUS_TONE;

  ngOnInit(): void {
    this.service.list().subscribe({
      next: (list) => this.imports.set(list),
      error: (error: unknown) =>
        this.error.set(apiErrorMessage(error, $localize`:@@lwConsoleImport-loadError:The import could not be loaded.`)),
    });
  }
}
