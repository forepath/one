import { CommonModule } from '@angular/common';
import { Component, computed, inject, input } from '@angular/core';
import { RouterModule } from '@angular/router';
import { NavigationNode } from '@forepath/agenstra/frontend/util-docs-parser';

import { DocsNavigationService } from '../../services';

@Component({
  selector: 'framework-docs-breadcrumbs',
  imports: [CommonModule, RouterModule],
  templateUrl: './docs-breadcrumbs.component.html',
  styleUrls: ['./docs-breadcrumbs.component.scss'],
  standalone: true,
})
export class DocsBreadcrumbsComponent {
  private readonly navigationService = inject(DocsNavigationService);

  /**
   * Current path
   */
  currentPath = input.required<string>();

  /**
   * Navigation nodes
   */
  navigationNodes = input.required<NavigationNode[]>();

  /**
   * Breadcrumb items
   */
  readonly breadcrumbs = computed(() => {
    const path = this.currentPath();
    const nodes = this.navigationNodes();

    return this.navigationService.getBreadcrumbs(nodes, path);
  });
}
