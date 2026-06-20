import { CommonModule, DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  effect,
  ElementRef,
  inject,
  input,
  OnDestroy,
  PLATFORM_ID,
  ViewChild,
} from '@angular/core';

import { ThemeService } from '../../services';

/**
 * Component for rendering Mermaid diagrams
 */
@Component({
  selector: 'framework-mermaid-diagram',
  imports: [CommonModule],
  templateUrl: './mermaid-diagram.component.html',
  styleUrls: ['./mermaid-diagram.component.scss'],
  standalone: true,
})
export class MermaidDiagramComponent implements AfterViewInit, OnDestroy {
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly document = inject<Document>(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly themeService = inject(ThemeService);

  /**
   * Mermaid diagram code
   */
  diagramCode = input.required<string>();

  /**
   * Unique ID for this diagram instance
   */
  readonly diagramId = `mermaid-${Math.random().toString(36).substring(2, 9)}`;

  @ViewChild('mermaidContainer', { static: false })
  private mermaidContainer!: ElementRef<HTMLDivElement>;

  private mermaidInstance: any = null;
  private mermaidLoadPromise: Promise<any> | null = null;
  private isRendered = false;

  constructor() {
    effect(() => {
      this.themeService.isDarkMode();

      if (!isPlatformBrowser(this.platformId) || !this.mermaidInstance) {
        return;
      }

      this.initializeMermaid(this.mermaidInstance);

      if (this.mermaidContainer && this.isRendered) {
        this.isRendered = false;
        void this.renderDiagram();
      }
    });
  }

  ngAfterViewInit(): void {
    this.renderDiagram();
  }

  ngOnDestroy(): void {
    // Reset rendered state if component is destroyed
    this.isRendered = false;
  }

  /**
   * Load Mermaid library and render diagram
   */
  private async renderDiagram(): Promise<void> {
    if (this.isRendered || !this.mermaidContainer) {
      return;
    }

    try {
      const mermaid = await this.loadMermaid();
      let code = this.diagramCode();

      // Clean up the code: ensure it's properly formatted
      code = code.trim();

      // Decode any HTML entities that might be present
      if (isPlatformBrowser(this.platformId)) {
        const tempDiv = this.document.createElement('div');

        tempDiv.innerHTML = code;
        code = tempDiv.textContent || tempDiv.innerText || code;
      } else {
        // During SSR, use a simple decode approach
        code = code
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'");
      }

      code = code.trim();

      // Validate that code is not empty
      if (!code || code.length === 0) {
        throw new Error('Empty Mermaid diagram code');
      }

      // Log the code being rendered (for debugging)
      console.debug('Rendering Mermaid diagram:', {
        id: this.diagramId,
        codeLength: code.length,
        codePreview: code.substring(0, 100),
      });

      // Render diagram using mermaid.render()
      // Note: mermaid.render() expects the code without the ```mermaid wrapper
      const { svg } = await mermaid.render(this.diagramId, code);

      if (this.mermaidContainer) {
        this.mermaidContainer.nativeElement.innerHTML = svg;
        this.isRendered = true;
        this.cdr.detectChanges();
      }
    } catch (error) {
      console.error('Error rendering Mermaid diagram:', error);
      console.error('Diagram code that failed:', this.diagramCode());

      if (this.mermaidContainer) {
        this.mermaidContainer.nativeElement.innerHTML = `
          <div class="alert alert-warning">
            <i class="bi bi-exclamation-triangle me-2"></i>
            Failed to render diagram. Please check the syntax.
            <details class="mt-2">
              <summary class="small">Error details</summary>
              <pre class="small mt-2">${error instanceof Error ? error.message : String(error)}</pre>
            </details>
          </div>
        `;
        this.cdr.detectChanges();
      }
    }
  }

  /**
   * Load Mermaid library dynamically
   */
  private async loadMermaid(): Promise<any> {
    if (this.mermaidInstance) {
      return this.mermaidInstance;
    }

    if (this.mermaidLoadPromise) {
      return this.mermaidLoadPromise;
    }

    this.mermaidLoadPromise = (async () => {
      try {
        const mermaidModule = await import('mermaid');

        this.mermaidInstance = mermaidModule.default;
        this.initializeMermaid(this.mermaidInstance);

        return this.mermaidInstance;
      } catch (error) {
        this.mermaidLoadPromise = null;
        throw error;
      }
    })();

    return this.mermaidLoadPromise;
  }

  private initializeMermaid(mermaid: { initialize: (config: object) => void }): void {
    mermaid.initialize({
      startOnLoad: false,
      theme: this.themeService.isDarkMode() ? 'dark' : 'default',
      securityLevel: 'loose',
      flowchart: {
        useMaxWidth: true,
        htmlLabels: true,
      },
    });
  }
}
