import { ChangeDetectionStrategy, Component, computed, inject, Injector, input, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  apiErrorMessage,
  ConsoleAccessFacade,
  type VmImageCatalogEntry,
  type VmRegistryImage,
  VirtualMachinesService,
} from '@forepath/loadweaver/frontend/data-access-console';
import { FpcAlertComponent, FpcButtonComponent } from '@forepath/shared/frontend/ui-components';
import { firstValueFrom } from 'rxjs';

import { catalogImportRequest, mayImportVmImages, registryImageOf, withoutDigest } from './vm-image-catalog';
import { LoadweaverVmImageCatalogComponent } from './vm-image-catalog.component';

/** What happened to the last pick (shown under the picker). */
export type VmRecommendedNotice =
  | { type: 'filled'; reference: string }
  | { type: 'importing'; reference: string }
  | { type: 'denied'; image: string }
  | { type: 'error'; message: string };

/**
 * "Recommended images" of the VirtualMachine wizard's image step (3.42): the catalog next to the project's own images.
 * Picking an image the project has (same `repository:tag` as the entry's suggestion) fills the image reference; else,
 * with import rights in the project (operator / admin), it starts the import and fills the reference it will have.
 * Without import rights it explains whom to ask. Services are resolved once the list is opened.
 */
@Component({
  selector: 'loadweaver-vm-recommended-images',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FpcAlertComponent, FpcButtonComponent, LoadweaverVmImageCatalogComponent],
  template: `
    <fpc-button
      variant="dark"
      size="sm"
      [ariaExpanded]="open()"
      (clicked)="toggle()"
      data-testid="vm-recommended-toggle"
    >
      <i class="bi bi-collection me-1" aria-hidden="true"></i
      ><span i18n="@@lwConsoleVmCatalog-recommendedImages">Recommended images</span>
    </fpc-button>
    @if (open()) {
      <div class="mt-2" data-testid="vm-recommended">
        @if (!mayImport()) {
          <p class="small text-body-secondary" i18n="@@lwConsoleVmCatalog-noImportHint">
            Images the project doesn't have yet are imported when picked; that needs operator or admin in the project.
          </p>
        }
        <loadweaver-vm-image-catalog
          idPrefix="lw-vm-catalog-wizard"
          [present]="presentRefs()"
          [selectedId]="pickedId()"
          (picked)="pick($event)"
        />
        @if (busy()) {
          <fpc-alert variant="info" [message]="busy() === 'checking' ? checkingLabel : startingLabel" />
        }
        @switch (notice()?.type) {
          @case ('filled') {
            <fpc-alert variant="success" [message]="noticeText()" data-testid="vm-recommended-notice" />
          }
          @case ('importing') {
            <fpc-alert variant="info" [message]="noticeText()" data-testid="vm-recommended-notice" />
          }
          @case ('denied') {
            <fpc-alert variant="warning" [message]="noticeText()" data-testid="vm-recommended-notice" />
          }
          @case ('error') {
            <fpc-alert variant="danger" [message]="noticeText()" data-testid="vm-recommended-notice" />
          }
        }
      </div>
    }
  `,
})
export class LoadweaverVmRecommendedImagesComponent {
  private readonly injector = inject(Injector);
  private readonly me = toSignal(inject(ConsoleAccessFacade).me$, { initialValue: null });

  /** The VM's project. */
  readonly project = input.required<string>();
  /** The image reference to put into `spec.image`. */
  readonly imageChange = output<string>();

  readonly open = signal(false);
  readonly busy = signal<'checking' | 'starting' | null>(null);
  readonly pickedId = signal<string | null>(null);
  readonly notice = signal<VmRecommendedNotice | null>(null);
  readonly registryImages = signal<VmRegistryImage[]>([]);
  /** The registry images load of a project (reloaded when the VM's project changes). */
  private registryLoad: { project: string; done: Promise<void> } | null = null;

  readonly mayImport = computed(() => mayImportVmImages(this.me(), this.project()));
  readonly presentRefs = computed(() => this.registryImages().map((i) => `${i.repository}:${i.tag}`));
  readonly noticeText = computed(() => {
    const notice = this.notice();

    switch (notice?.type) {
      case 'filled':
        return $localize`:@@lwConsoleVmCatalog-filled:Image set to {reference} (already in the project).`.replace(
          '{reference}',
          notice.reference,
        );
      case 'importing':
        return $localize`:@@lwConsoleVmCatalog-importing:Importing {reference} into the project's registry; plan the VM once the import has finished (VM images of this project).`.replace(
          '{reference}',
          notice.reference,
        );
      case 'denied':
        return $localize`:@@lwConsoleVmCatalog-denied:Project {project} doesn't have {image} yet, and importing needs operator or admin there. Ask one to import it, or pick an image the project has.`
          .replace('{project}', this.project())
          .replace('{image}', notice.image);
      case 'error':
        return notice.message;
      default:
        return '';
    }
  });
  readonly checkingLabel = $localize`:@@lwConsoleVmCatalog-checking:Checking the project's images…`;
  readonly startingLabel = $localize`:@@lwConsoleVmCatalog-starting:Starting the import…`;
  private readonly startFailedLabel = $localize`:@@lwConsoleVmCatalog-startFailed:The import couldn't be started.`;

  toggle(): void {
    this.open.update((open) => !open);

    if (this.open()) void this.loadRegistry();
  }

  async pick(entry: VmImageCatalogEntry): Promise<void> {
    if (this.busy()) return;

    const project = this.project();

    this.pickedId.set(entry.id);
    this.notice.set(null);
    this.busy.set('checking');

    try {
      await this.loadRegistry();

      const existing = registryImageOf(entry, this.registryImages());

      if (existing) {
        const reference = withoutDigest(existing.reference);

        this.imageChange.emit(reference);
        this.notice.set({ type: 'filled', reference });

        return;
      }

      if (!this.mayImport()) {
        this.notice.set({ type: 'denied', image: entry.suggestedRef });

        return;
      }

      this.busy.set('starting');

      const imported = await firstValueFrom(this.api().importImage(project, catalogImportRequest(entry)));
      const reference = withoutDigest(imported.reference);

      this.imageChange.emit(reference);
      this.notice.set({ type: 'importing', reference });
    } catch (error) {
      this.notice.set({ type: 'error', message: apiErrorMessage(error, this.startFailedLabel) });
    } finally {
      this.busy.set(null);
    }
  }

  /** The project's registry images (a failed list is an empty one: picking then imports, the server reuses blobs). */
  private loadRegistry(): Promise<void> {
    const project = this.project();

    if (this.registryLoad?.project !== project) {
      const done = firstValueFrom(this.api().registryImages(project)).then(
        (images) => this.registryImages.set(images),
        () => this.registryImages.set([]),
      );

      this.registryLoad = { project, done };
    }

    return this.registryLoad.done;
  }

  private api(): VirtualMachinesService {
    return this.injector.get(VirtualMachinesService);
  }
}
