import { Component, computed, input } from '@angular/core';
import type { VmImportProgress } from '@forepath/loadweaver/frontend/data-access-console';
import { FpcProgressComponent } from '@forepath/shared/frontend/ui-components';

import { formatBytes } from '../overview/console-format';
import { importAmount, importBar, importPhaseLabel } from './vm-format';

/**
 * A VM's boot disk import (F4): phase, bytes of the total and a progress bar while the disk is written (the download
 * and the queue have no total). Used by the VM list and the detail page.
 */
@Component({
  selector: 'loadweaver-vm-import-progress',
  imports: [FpcProgressComponent],
  template: `
    <span class="d-flex flex-wrap align-items-center gap-2 small" data-testid="vm-import-progress">
      <span class="text-nowrap" [class.text-danger]="failed()">
        <i class="bi me-1 {{ failed() ? 'bi-exclamation-triangle' : 'bi-cloud-arrow-down' }}" aria-hidden="true"></i
        >{{ label() }}
      </span>
      @if (bar(); as b) {
        <fpc-progress
          class="flex-grow-1 vm-import-progress__bar"
          height="0.5rem"
          [value]="b.value"
          [max]="b.max"
          [striped]="true"
          [animated]="true"
          [ariaLabel]="label()"
        />
        <span class="text-nowrap text-body-secondary">{{ b.percent }}%</span>
      }
      @if (amount()) {
        <span class="text-nowrap text-body-secondary" data-testid="vm-import-amount">{{ amount() }}</span>
      }
    </span>
  `,
  styles: `
    .vm-import-progress__bar {
      min-width: 6rem;
      max-width: 16rem;
    }
  `,
})
export class LoadweaverVmImportProgressComponent {
  readonly progress = input.required<VmImportProgress>();

  protected readonly failed = computed(() => this.progress().phase === 'failed');
  protected readonly label = computed(() => importPhaseLabel(this.progress().phase));
  protected readonly bar = computed(() => importBar(this.progress()));
  protected readonly amount = computed(() => importAmount(this.progress(), formatBytes));
}
