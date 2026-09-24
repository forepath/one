import { CommonModule } from '@angular/common';
import { Component, computed, inject, input } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { FpcBreadcrumbItemComponent, FpcBreadcrumbsComponent } from '@forepath/shared/frontend/ui-components';
import { NavigationNode } from '@forepath/shared/frontend/util-docs-parser';

import { DocsNavigationService } from '../../services';

@Component({
  selector: 'framework-docs-breadcrumbs',
  imports: [CommonModule, RouterModule, FpcBreadcrumbsComponent, FpcBreadcrumbItemComponent],
  templateUrl: './docs-breadcrumbs.component.html',
  styleUrls: ['./docs-breadcrumbs.component.scss'],
  standalone: true,
})
export class DocsBreadcrumbsComponent {
  private readonly navigationService = inject(DocsNavigationService);
  private readonly router = inject(Router);

  readonly documentationLabel = $localize`:@@featureDocsBreadcrumbs-documentation:Documentation`;
  readonly breadcrumbAriaLabel = $localize`:@@featureDocsBreadcrumbs-ariaLabel:Breadcrumb`;

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

  onCrumbSelected(event: MouseEvent, path: string): void {
    event.preventDefault();
    void this.router.navigateByUrl(path);
  }
}
