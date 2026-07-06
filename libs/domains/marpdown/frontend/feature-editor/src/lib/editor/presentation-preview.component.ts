import { CommonModule } from '@angular/common';
import {
  Component,
  DestroyRef,
  ElementRef,
  Input,
  OnChanges,
  SimpleChanges,
  ViewChild,
  inject,
} from '@angular/core';

import { ThemeService } from '../theme.service';
import { PresentationMarpRenderService } from './presentation-marp-render.service';

@Component({
  selector: 'marpdown-presentation-preview',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './presentation-preview.component.html',
  styleUrls: ['./presentation-preview.component.scss'],
})
export class PresentationPreviewComponent implements OnChanges {
  @ViewChild('previewHost', { static: true })
  private previewHost!: ElementRef<HTMLDivElement>;

  @Input({ required: true }) presentationId!: string;
  @Input() markdown = '';

  protected readonly themeService = inject(ThemeService);
  private readonly marpRenderService = inject(PresentationMarpRenderService);
  private readonly destroyRef = inject(DestroyRef);
  private disposeRender: (() => void) | null = null;
  private renderVersion = 0;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['markdown'] || changes['presentationId']) {
      void this.renderPreview();
    }
  }

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.disposeRender?.();
      this.disposeRender = null;
    });
  }

  private async renderPreview(): Promise<void> {
    const version = ++this.renderVersion;

    this.disposeRender?.();
    this.disposeRender = null;

    const result = await this.marpRenderService.render(this.presentationId, this.markdown);

    if (version !== this.renderVersion) {
      result.dispose();
      return;
    }

    this.disposeRender = result.dispose;
    this.previewHost.nativeElement.innerHTML = result.html;
  }
}
