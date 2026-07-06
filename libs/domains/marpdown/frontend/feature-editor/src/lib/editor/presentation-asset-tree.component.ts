import { CommonModule } from '@angular/common';
import { Component, DestroyRef, Input, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AssetsFacade, type FileNodeDto } from '@forepath/marpdown/frontend/data-access-editor';

@Component({
  selector: 'marpdown-presentation-asset-tree',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './presentation-asset-tree.component.html',
  styleUrls: ['./presentation-asset-tree.component.scss'],
})
export class PresentationAssetTreeComponent implements OnInit {
  @Input({ required: true }) presentationId!: string;

  private readonly assetsFacade = inject(AssetsFacade);
  private readonly destroyRef = inject(DestroyRef);

  rootNodes: FileNodeDto[] = [];
  childNodes = new Map<string, FileNodeDto[]>();
  expandedPaths = new Set<string>(['.']);
  loading = false;

  ngOnInit(): void {
    this.refreshRoot();

    this.assetsFacade
      .getDirectoryListing$(this.presentationId, '.')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((nodes) => {
        if (nodes) {
          this.rootNodes = nodes;
        }
      });

    this.assetsFacade
      .getIsListingDirectory$(this.presentationId, '.')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((isListing) => {
        this.loading = isListing;
      });
  }

  refreshRoot(): void {
    this.assetsFacade.listDirectory(this.presentationId, '.');
  }

  toggleDirectory(path: string): void {
    if (this.expandedPaths.has(path)) {
      this.expandedPaths.delete(path);

      return;
    }

    this.expandedPaths.add(path);
    this.assetsFacade.listDirectory(this.presentationId, path);

    this.assetsFacade
      .getDirectoryListing$(this.presentationId, path)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((nodes) => {
        if (nodes) {
          this.childNodes.set(path, nodes);
        }
      });
  }

  isExpanded(path: string): boolean {
    return this.expandedPaths.has(path);
  }

  getNodes(path: string): FileNodeDto[] {
    return path === '.' ? this.rootNodes : (this.childNodes.get(path) ?? []);
  }
}
