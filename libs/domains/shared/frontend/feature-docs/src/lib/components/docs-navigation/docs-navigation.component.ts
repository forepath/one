import { CommonModule } from '@angular/common';
import { Component, computed, inject, input, signal } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { NavigationNode } from '@forepath/shared/frontend/util-docs-parser';

import { DocsNavigationService } from '../../services';

@Component({
  selector: 'framework-docs-navigation',
  imports: [CommonModule, RouterModule],
  templateUrl: './docs-navigation.component.html',
  styleUrls: ['./docs-navigation.component.scss'],
  standalone: true,
})
export class DocsNavigationComponent {
  private readonly navigationService = inject(DocsNavigationService);
  private readonly router = inject(Router);

  /**
   * Navigation nodes
   */
  navigationNodes = input.required<NavigationNode[]>();

  /**
   * Current active path
   */
  readonly activePath = computed(() => this.navigationService.activePath());

  /**
   * Expanded sections (tracked by path)
   */
  readonly expandedSections = signal<Set<string>>(new Set());

  /**
   * Toggle section expansion
   */
  toggleSection(path: string): void {
    const expanded = new Set(this.expandedSections());

    if (expanded.has(path)) {
      expanded.delete(path);
    } else {
      expanded.add(path);
    }

    this.expandedSections.set(expanded);
  }

  /**
   * Check if section is expanded
   */
  isExpanded(path: string): boolean {
    return this.expandedSections().has(path);
  }

  /**
   * Check if node is active
   */
  isActive(node: NavigationNode): boolean {
    return this.activePath() === node.path;
  }

  /**
   * Handle node click
   */
  onNodeClick(node: NavigationNode, event: Event): void {
    if (node.children && node.children.length > 0) {
      event.preventDefault();
      this.toggleSection(node.path);
    } else {
      this.router.navigate([node.path]);
      this.navigationService.setActivePath(node.path);
    }
  }
}
