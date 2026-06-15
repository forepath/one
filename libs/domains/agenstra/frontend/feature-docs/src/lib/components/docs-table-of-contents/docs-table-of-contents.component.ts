import { CommonModule } from '@angular/common';
import { Component, computed, input, signal } from '@angular/core';
import { DocHeading } from '@forepath/agenstra/frontend/util-docs-parser';

@Component({
  selector: 'framework-docs-table-of-contents',
  imports: [CommonModule],
  templateUrl: './docs-table-of-contents.component.html',
  styleUrls: ['./docs-table-of-contents.component.scss'],
  standalone: true,
})
export class DocsTableOfContentsComponent {
  /**
   * Headings from the current page
   */
  headings = input<DocHeading[]>([]);

  /**
   * Active heading ID (for highlighting)
   */
  activeHeadingId = signal<string | null>(null);

  /**
   * Filtered headings (H2-H4 typically shown in TOC)
   */
  readonly tocHeadings = computed(() => {
    return this.headings().filter((h) => h.level >= 2 && h.level <= 4);
  });

  /**
   * Scroll to heading
   */
  scrollToHeading(headingId: string): void {
    const element = document.getElementById(headingId);

    if (!element) {
      return;
    }

    // Find the scrollable container (docs-content-area-container)
    const scrollableContainer = element.closest('.docs-content-area-container') as HTMLElement;

    if (scrollableContainer) {
      // Calculate position relative to the scrollable container
      const containerRect = scrollableContainer.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();
      const offset = 80; // Account for sticky header
      // Calculate the scroll position: element position relative to container + current scroll position - offset
      const scrollPosition = elementRect.top - containerRect.top + scrollableContainer.scrollTop - offset;

      scrollableContainer.scrollTo({
        top: scrollPosition,
        behavior: 'smooth',
      });
    } else {
      // Fallback to window scrolling if container not found
      const offset = 80;
      const elementPosition = element.getBoundingClientRect().top;
      const offsetPosition = elementPosition + window.pageYOffset - offset;

      window.scrollTo({
        top: offsetPosition,
        behavior: 'smooth',
      });
    }

    this.activeHeadingId.set(headingId);
  }

  /**
   * Get heading class based on level
   */
  getHeadingClass(level: number): string {
    return `toc-level-${level}`;
  }
}
