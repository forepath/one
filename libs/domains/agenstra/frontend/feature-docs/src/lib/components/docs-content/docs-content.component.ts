import { CommonModule, DOCUMENT, isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import {
  AfterViewInit,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  PLATFORM_ID,
  signal,
  ViewChild,
  ViewContainerRef,
} from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { DocMetadata } from '@forepath/agenstra/frontend/util-docs-parser';
import { catchError, map, of } from 'rxjs';

import { MermaidDiagramComponent } from '../mermaid-diagram/mermaid-diagram.component';

/**
 * Component for rendering markdown content
 */
@Component({
  selector: 'framework-docs-content',
  imports: [CommonModule, MermaidDiagramComponent],
  templateUrl: './docs-content.component.html',
  styleUrls: ['./docs-content.component.scss'],
  standalone: true,
})
export class DocsContentComponent implements AfterViewInit {
  private readonly sanitizer = inject(DomSanitizer);
  private readonly document = inject<Document>(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly viewContainer = inject(ViewContainerRef);
  private readonly http = inject(HttpClient);

  /**
   * Documentation metadata
   */
  metadata = input<DocMetadata | null>(null);

  /**
   * Mermaid diagrams extracted from content
   */
  readonly mermaidDiagrams = signal<Array<{ id: string; code: string }>>([]);

  /**
   * Sanitized HTML content
   */
  readonly htmlContent = computed(() => {
    const meta = this.metadata();

    if (!meta?.html) {
      return '';
    }

    // Process HTML to replace mermaid code blocks with placeholders
    let html = meta.html;
    // Replace mermaid code blocks with placeholders (diagrams are handled separately via effect)
    const mermaidRegex = /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/gi;
    let match;
    let diagramIndex = 0;

    while ((match = mermaidRegex.exec(html)) !== null) {
      const diagramId = `mermaid-${diagramIndex++}`;

      html = html.replace(match[0], `<div class="mermaid-placeholder" data-diagram-id="${diagramId}"></div>`);
    }

    // Process links to convert to router links
    html = this.processLinks(html);

    return this.sanitizer.sanitize(1, html) || '';
  });

  @ViewChild('contentContainer', { static: false })
  private contentContainer!: ElementRef<HTMLDivElement>;

  constructor() {
    // Extract mermaid diagrams when metadata changes
    effect(() => {
      const meta = this.metadata();

      if (!meta) {
        this.mermaidDiagrams.set([]);

        return;
      }

      // Extract mermaid diagrams from raw markdown content (not HTML) to avoid HTML entity encoding issues
      // This is more reliable than extracting from HTML
      const mermaidDiagrams: Array<{ id: string; code: string }> = [];

      // Try to extract from raw content first (if available)
      if (meta.content) {
        const mermaidRegex = /```mermaid\s*([\s\S]*?)```/gi;
        let match;
        let diagramIndex = 0;

        while ((match = mermaidRegex.exec(meta.content)) !== null) {
          const diagramId = `mermaid-${diagramIndex++}`;
          let code = match[1].trim();

          // Clean up the code: normalize line endings and trim
          code = code.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();

          mermaidDiagrams.push({ id: diagramId, code });
        }
      }

      // Fallback: if no raw content or no diagrams found, try extracting from HTML
      if (mermaidDiagrams.length === 0 && meta.html) {
        const mermaidRegex = /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/gi;
        let match;
        let diagramIndex = 0;

        while ((match = mermaidRegex.exec(meta.html)) !== null) {
          const diagramId = `mermaid-${diagramIndex++}`;
          let code = match[1];

          // Decode HTML entities that might have been encoded by marked
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

          // Clean up the code: normalize line endings and trim
          code = code.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();

          mermaidDiagrams.push({ id: diagramId, code });
        }
      }

      this.mermaidDiagrams.set(mermaidDiagrams);
    });

    // Add IDs to headings for anchor links when metadata changes
    // Also replace mermaid placeholders when diagrams are ready
    // Note: contentContainer may not be available yet, so we check in ngAfterViewInit too
    effect(() => {
      const meta = this.metadata();
      const diagrams = this.mermaidDiagrams();

      if (meta && this.contentContainer) {
        // Use setTimeout to ensure DOM is ready
        setTimeout(() => {
          this.addHeadingIds(meta.headings);

          // Replace placeholders if diagrams are ready
          if (diagrams.length > 0) {
            this.replaceMermaidPlaceholders();
          }

          // Remove links to non-existent files
          this.removeInvalidLinks();
        }, 0);
      }
    });
  }

  ngAfterViewInit(): void {
    // Trigger heading ID assignment if metadata is already loaded
    // This handles the case where metadata was set before the view was initialized
    const meta = this.metadata();
    const diagrams = this.mermaidDiagrams();

    if (meta && this.contentContainer) {
      setTimeout(() => {
        this.addHeadingIds(meta.headings);

        // Only replace if diagrams are ready
        if (diagrams.length > 0) {
          this.replaceMermaidPlaceholders();
        }
      }, 100); // Slightly longer delay to ensure DOM is fully ready
    }
  }

  /**
   * Replace mermaid placeholders in the DOM with actual rendered diagrams
   */
  private replaceMermaidPlaceholders(): void {
    if (!this.contentContainer || !isPlatformBrowser(this.platformId)) {
      return;
    }

    const container = this.contentContainer.nativeElement;
    const diagrams = this.mermaidDiagrams();

    // Only process if we have diagrams
    if (diagrams.length === 0) {
      return;
    }

    // Find all mermaid code blocks (either placeholders or actual code blocks)
    // We need to find the actual <pre> elements to replace, not just the code elements
    const preElements = Array.from(container.querySelectorAll('pre'));
    const mermaidPreElements: Element[] = [];

    // Filter to only include <pre> elements that contain mermaid code
    for (const pre of preElements) {
      const codeElement = pre.querySelector('code.language-mermaid');
      const placeholder = pre.querySelector('.mermaid-placeholder');

      if (codeElement || placeholder) {
        mermaidPreElements.push(pre);
      }
    }

    // Also check for standalone placeholder divs (not inside pre)
    const standalonePlaceholders = Array.from(container.querySelectorAll('.mermaid-placeholder')).filter(
      (p) => !p.closest('pre'),
    );
    // Combine both: pre elements first, then standalone placeholders
    // This matches the order they appear in the HTML
    const allElementsToReplace = [...mermaidPreElements, ...standalonePlaceholders];

    if (allElementsToReplace.length === 0) {
      return;
    }

    // Ensure we don't process more elements than we have diagrams
    const elementsToProcess = allElementsToReplace.slice(0, diagrams.length);

    // Process in reverse order to avoid index issues when replacing DOM elements
    // When we replace an element, it doesn't affect the indices of elements we haven't processed yet
    for (let i = elementsToProcess.length - 1; i >= 0; i--) {
      const elementToReplace = elementsToProcess[i];
      const diagram = diagrams[i];

      if (!diagram || !elementToReplace.parentNode) {
        continue;
      }

      // Skip if already replaced (check if element still exists in DOM)
      if (!elementToReplace.parentNode) {
        continue;
      }

      // Create a wrapper div for the mermaid diagram
      const wrapper = this.document.createElement('div');

      wrapper.className = 'mermaid-diagram-wrapper';

      // Create the mermaid diagram component dynamically
      // First create it in the view container (for Angular change detection)
      const componentRef = this.viewContainer.createComponent(MermaidDiagramComponent);

      componentRef.setInput('diagramCode', diagram.code);

      // Get the component's host element
      const componentElement = componentRef.location.nativeElement;

      // Remove it from the view container's location
      componentElement.remove();

      // Append it to the wrapper
      wrapper.appendChild(componentElement);

      // Replace element with the wrapper (which now contains the component)
      elementToReplace.parentNode.replaceChild(wrapper, elementToReplace);
    }
  }

  /**
   * Process links in HTML to convert markdown links to router links
   * If a link doesn't include a folder path, preserve the current file's folder name
   * Handles README.md files by treating links as relative to the folder containing the README
   * Preserves external links and YAML file links as-is
   */
  private processLinks(html: string): string {
    const metadata = this.metadata();

    if (!metadata) {
      return html;
    }

    // Get the current file path
    const currentFilePath = metadata.path;
    // Check if this is a README.md file
    const isReadme = currentFilePath.toLowerCase().endsWith('readme.md');
    // For README.md files, use the folder path as the base (one level up from the file)
    // For other files, use the file's folder path
    let basePath: string;

    if (isReadme) {
      // For README.md, the base is the folder containing it
      // e.g., "api-reference/README.md" -> base is "api-reference"
      basePath = currentFilePath.includes('/') ? currentFilePath.substring(0, currentFilePath.lastIndexOf('/')) : '';
    } else {
      // For regular files, the base is the folder containing the file
      // e.g., "architecture/system-overview.md" -> base is "architecture"
      basePath = currentFilePath.includes('/') ? currentFilePath.substring(0, currentFilePath.lastIndexOf('/')) : '';
    }

    // Process all links, but handle different types differently
    const linkRegex = /<a href="([^"]+)">/gi;

    return html.replace(linkRegex, (match, path) => {
      // Skip external links (http://, https://, mailto:, etc.)
      if (/^(https?:\/\/|mailto:)/i.test(path)) {
        return match; // Keep external links as-is
      }

      // Skip absolute paths starting with /
      if (path.startsWith('/')) {
        return match; // Keep absolute paths as-is
      }

      // Handle YAML files - keep them as direct links (not router links)
      if (path.endsWith('.yaml') || path.endsWith('.yml')) {
        return `<a href="${path}" target="_blank" rel="noopener noreferrer">`;
      }

      // Only process markdown file links
      if (!path.endsWith('.md')) {
        return match; // Keep non-markdown links as-is
      }

      // Remove .md extension
      let routePath = path.replace(/\.md$/, '');

      // Remove leading ./ if present
      routePath = routePath.replace(/^\.\//, '');

      // Resolve relative paths (handle ../ and ./)
      if (routePath.startsWith('../')) {
        // Handle going up directories
        const parts = basePath.split('/').filter((p: string) => p);
        const relativeParts = routePath.split('/').filter((p: string) => p);
        // Remove ../ parts and corresponding base parts
        let i = 0;

        while (i < relativeParts.length && relativeParts[i] === '..') {
          if (parts.length > 0) {
            parts.pop();
          }

          i++;
        }

        // Combine remaining base parts with remaining relative parts
        routePath = [...parts, ...relativeParts.slice(i)].join('/');
      } else if (!routePath.includes('/') && basePath) {
        // If the path doesn't contain a slash (no folder), it's relative to the base folder
        routePath = `${basePath}/${routePath}`;
      } else if (routePath.startsWith('./')) {
        // Remove ./ prefix and resolve relative to base
        routePath = routePath.replace(/^\.\//, '');

        if (basePath) {
          routePath = `${basePath}/${routePath}`;
        }
      }

      // Remove any "agenstra/" prefix if present (shouldn't happen in markdown, but handle it)
      routePath = routePath.replace(/^agenstra\//, '');

      // If the path ends with /README or README, remove it since path resolution handles README.md automatically
      // e.g., "something/README" -> "something", "README" -> ""
      routePath = routePath.replace(/\/README$/, '').replace(/^README$/, '');

      // Determine route based on folder
      const finalRoutePath = routePath ? `/docs/${routePath}` : '/docs';

      if (finalRoutePath.startsWith('/docs/../') || finalRoutePath.includes('/../')) {
        return `<a data-md-link="${path}">`;
      }

      // Store the original file path for later validation
      // We'll add a data attribute to identify links that need validation
      return `<a href="${finalRoutePath}" routerLink="${finalRoutePath}" data-md-link="${path}">`;
    });
  }

  /**
   * Remove links to markdown files that don't exist
   * Only files in the "agenstra" folder are considered valid
   * All internal links must resolve to routes starting with /agenstra or /framework
   */
  private removeInvalidLinks(): void {
    if (!this.contentContainer || !isPlatformBrowser(this.platformId)) {
      return;
    }

    const metadata = this.metadata();

    if (!metadata) {
      return;
    }

    // Get the current file's folder path (e.g., "architecture" from "architecture/README.md")
    const currentFilePath = metadata.path;
    const currentFileFolder = currentFilePath.includes('/')
      ? currentFilePath.substring(0, currentFilePath.lastIndexOf('/'))
      : '';
    const container = this.contentContainer.nativeElement;
    const links = Array.from(container.querySelectorAll<HTMLAnchorElement>('a[data-md-link]'));

    // Process all links to check if they exist
    links.forEach((link) => {
      const originalPath = link.getAttribute('data-md-link');

      if (!originalPath) {
        return;
      }

      // Get the href from the link to check if it starts with /agenstra or /framework
      const href = link.getAttribute('href');

      if (!href || (!href.startsWith('/agenstra') && !href.startsWith('/framework'))) {
        // Link doesn't start with /agenstra or /framework, mark as invalid
        const text = link.textContent || link.innerText;
        const textNode = this.document.createTextNode(text);

        link.parentNode?.replaceChild(textNode, link);

        return;
      }

      // Convert the original markdown path to the file path we need to check
      let filePath = originalPath.replace(/\.md$/, '');

      // Remove leading ./ if present
      filePath = filePath.replace(/^\.\//, '');

      // If the path doesn't contain a slash (no folder), preserve the current folder
      if (!filePath.includes('/') && currentFileFolder) {
        filePath = `${currentFileFolder}/${filePath}`;
      }

      // Add .md extension back for file checking
      const fullFilePath = `${filePath}.md`;
      // Check if file exists by trying to load it with HEAD request
      // Files are served from /agenstra/ route, so we need to prepend "agenstra/"
      const assetPath = `/agenstra/${fullFilePath}`;

      this.http
        .head(assetPath, { observe: 'response' })
        .pipe(
          map((response) => response.status === 200),
          catchError(() => of(false)),
        )
        .subscribe((exists) => {
          if (!exists) {
            // File doesn't exist, remove the link but keep the text
            const text = link.textContent || link.innerText;
            const textNode = this.document.createTextNode(text);

            link.parentNode?.replaceChild(textNode, link);
          } else {
            // File exists, remove the data attribute as it's no longer needed
            link.removeAttribute('data-md-link');
          }
        });
    });
  }

  /**
   * Add IDs to headings for anchor links
   */
  private addHeadingIds(headings: Array<{ id: string; text: string }>): void {
    if (!this.contentContainer) {
      return;
    }

    const container = this.contentContainer.nativeElement;
    const headingElements = container.querySelectorAll('h1, h2, h3, h4, h5, h6');

    headingElements.forEach((heading, index) => {
      if (index < headings.length) {
        heading.id = headings[index].id;
      }
    });
  }

  /**
   * Get mermaid diagram code by ID
   */
  getMermaidCode(diagramId: string): string | null {
    const diagram = this.mermaidDiagrams().find((d) => d.id === diagramId);

    return diagram?.code || null;
  }
}
