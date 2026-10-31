import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { AttachmentResponseDto } from '@forepath/agenstra/frontend/data-access-agent-console';

/** Human-readable file size (B / KB / MB / GB). */
export function formatAttachmentSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${Math.max(0, Math.round(bytes || 0))} B`;

  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }

  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/**
 * Attachments of a ticket / knowledge page as chips (3.38: key-value data and attachments are chips, not tables):
 * name + size (click downloads), × deletes.
 */
@Component({
  selector: 'framework-attachment-chips',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ag-attachment-chips' },
  template: `
    <ul class="ag-attachment-chips__list list-unstyled mb-0" [attr.aria-label]="listLabel">
      @for (attachment of attachments(); track attachment.id) {
        <li class="ag-attachment-chips__chip" data-testid="attachment-chip">
          <button
            type="button"
            class="ag-attachment-chips__open"
            [title]="downloadLabel + ': ' + attachment.fileName"
            (click)="download.emit(attachment)"
          >
            <i class="bi bi-paperclip" aria-hidden="true"></i>
            <span class="ag-attachment-chips__name">{{ attachment.fileName }}</span>
            <span class="ag-attachment-chips__size">{{ size(attachment.byteSize) }}</span>
          </button>
          <button
            type="button"
            class="ag-attachment-chips__remove btn-close btn-close-sm"
            [attr.aria-label]="deleteLabel + ': ' + attachment.fileName"
            [title]="deleteLabel"
            (click)="remove.emit(attachment)"
          ></button>
        </li>
      }
    </ul>
  `,
  styles: `
    .ag-attachment-chips__list {
      display: flex;
      flex-wrap: wrap;
      gap: 0.375rem;
    }
    .ag-attachment-chips__chip {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      max-width: 100%;
      padding: 0.125rem 0.375rem 0.125rem 0.5rem;
      border: 1px solid var(--bs-border-color);
      border-radius: 999px;
      background: var(--bs-tertiary-bg);
      font-size: 0.8125rem;
    }
    .ag-attachment-chips__open {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      min-width: 0;
      padding: 0;
      border: 0;
      background: none;
      color: inherit;
    }
    .ag-attachment-chips__open:hover .ag-attachment-chips__name {
      text-decoration: underline;
    }
    .ag-attachment-chips__name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 16rem;
    }
    .ag-attachment-chips__size {
      color: var(--bs-secondary-color);
      white-space: nowrap;
    }
    .ag-attachment-chips__remove {
      font-size: 0.5rem;
      padding: 0.25rem;
    }
  `,
})
export class AttachmentChipsComponent {
  readonly attachments = input<readonly AttachmentResponseDto[]>([]);

  readonly download = output<AttachmentResponseDto>();
  readonly remove = output<AttachmentResponseDto>();

  protected readonly listLabel = $localize`:@@featureAgentConsoleAttachments-list:Attachments`;
  protected readonly downloadLabel = $localize`:@@featureAgentConsoleAttachments-download:Download`;
  protected readonly deleteLabel = $localize`:@@featureAgentConsoleAttachments-delete:Delete attachment`;
  protected readonly size = formatAttachmentSize;
}
