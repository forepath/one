import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  DestroyRef,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  Output,
  ViewChild,
  inject,
} from '@angular/core';

import { ThemeService } from '../theme.service';
import { PresentationMarpRenderService } from './presentation-marp-render.service';

@Component({
  selector: 'marpdown-presentation-presenter',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './presentation-presenter.component.html',
  styleUrls: ['./presentation-presenter.component.scss'],
})
export class PresentationPresenterComponent implements AfterViewInit {
  @ViewChild('presenterRoot', { static: true })
  private presenterRoot!: ElementRef<HTMLDivElement>;

  @ViewChild('slidesHost', { static: true })
  private slidesHost!: ElementRef<HTMLDivElement>;

  @Input({ required: true }) presentationId!: string;
  @Input({ required: true }) markdown = '';

  @Output() closed = new EventEmitter<void>();

  protected activeSlideIndex = 0;
  protected contentSlideCount = 1;
  protected rendering = true;

  protected readonly themeService = inject(ThemeService);
  private readonly marpRenderService = inject(PresentationMarpRenderService);
  private readonly destroyRef = inject(DestroyRef);

  private disposeRender: (() => void) | null = null;
  private renderVersion = 0;
  private closing = false;

  protected get isEndSlide(): boolean {
    return this.activeSlideIndex >= this.contentSlideCount;
  }

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.disposeRender?.();
      this.disposeRender = null;
      document.removeEventListener('fullscreenchange', this.onFullscreenChange);
    });
  }

  async ngAfterViewInit(): Promise<void> {
    document.addEventListener('fullscreenchange', this.onFullscreenChange);
    await this.renderSlides();
    await this.enterFullscreen();
    this.presenterRoot.nativeElement.focus();
  }

  @HostListener('document:keydown', ['$event'])
  protected onKeyDown(event: KeyboardEvent): void {
    if (this.rendering) {
      return;
    }

    if (this.isEndSlide) {
      event.preventDefault();
      void this.exitPresenter();
      return;
    }

    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
      case ' ':
      case 'PageDown':
        event.preventDefault();
        this.nextSlide();
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
      case 'PageUp':
        event.preventDefault();
        this.previousSlide();
        break;
      case 'Home':
        event.preventDefault();
        this.goToSlide(0);
        break;
      case 'End':
        event.preventDefault();
        this.goToSlide(this.contentSlideCount - 1);
        break;
      case 'Escape':
        event.preventDefault();
        void this.exitPresenter();
        break;
      default:
        break;
    }
  }

  protected onStageClick(event: MouseEvent): void {
    if (this.rendering) {
      return;
    }

    if (this.isEndSlide) {
      void this.exitPresenter();
      return;
    }

    const bounds = this.slidesHost.nativeElement.getBoundingClientRect();
    const relativeX = event.clientX - bounds.left;

    if (relativeX < bounds.width * 0.35) {
      this.previousSlide();
      return;
    }

    if (relativeX > bounds.width * 0.65) {
      this.nextSlide();
    }
  }

  protected nextSlide(): void {
    this.goToSlide(Math.min(this.activeSlideIndex + 1, this.contentSlideCount));
  }

  protected previousSlide(): void {
    this.goToSlide(Math.max(this.activeSlideIndex - 1, 0));
  }

  private readonly onFullscreenChange = (): void => {
    if (this.closing || document.fullscreenElement === this.presenterRoot.nativeElement) {
      return;
    }

    void this.exitPresenter(false);
  };

  private async renderSlides(): Promise<void> {
    const version = ++this.renderVersion;

    this.disposeRender?.();
    this.disposeRender = null;

    const result = await this.marpRenderService.render(this.presentationId, this.markdown, {
      hidePagination: true,
    });

    if (version !== this.renderVersion) {
      result.dispose();
      return;
    }

    this.disposeRender = result.dispose;
    this.contentSlideCount = result.slideCount;
    this.slidesHost.nativeElement.innerHTML = result.html;
    this.activeSlideIndex = 0;
    this.updateVisibleSlide();
    this.rendering = false;
  }

  private goToSlide(index: number): void {
    if (index === this.activeSlideIndex) {
      return;
    }

    this.activeSlideIndex = index;
    this.updateVisibleSlide();
  }

  private updateVisibleSlide(): void {
    const slides = this.slidesHost.nativeElement.querySelectorAll('svg[data-marpit-svg]');

    slides.forEach((slide, index) => {
      slide.classList.toggle('presenter-slide--active', !this.isEndSlide && index === this.activeSlideIndex);
    });
  }

  private async enterFullscreen(): Promise<void> {
    try {
      await this.presenterRoot.nativeElement.requestFullscreen();
    } catch {
      // Presenter still works when fullscreen is blocked.
    }
  }

  private async exitPresenter(exitFullscreen = true): Promise<void> {
    if (this.closing) {
      return;
    }

    this.closing = true;

    if (exitFullscreen && document.fullscreenElement === this.presenterRoot.nativeElement) {
      try {
        await document.exitFullscreen();
      } catch {
        // Ignore fullscreen exit errors.
      }
    }

    this.closed.emit();
  }
}
