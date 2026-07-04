import { AsyncPipe, CurrencyPipe, NgClass, isPlatformServer } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  LOCALE_ID,
  OnInit,
  PLATFORM_ID,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Meta, Title } from '@angular/platform-browser';
import { Router, RouterModule } from '@angular/router';
import {
  ProjectEstimatorFacade,
  formatProjectEstimateContactMessage,
  listMemoryProfileSwitcherOptions,
  type DeviceCapabilityStatus,
  type ForepathLlmMemoryProfileId,
  type ProjectEstimatorDebugPreset,
} from '@forepath/forepath/frontend/data-access-project-estimator';
import { storeContactMessagePrefill } from '@forepath/shared/frontend/feature-landingpage';
import { ENVIRONMENT, type Environment } from '@forepath/shared/frontend/util-configuration';
import { addPageMetaTags, buildPageMetaTags } from '@forepath/shared/frontend/util-meta';
import { firstValueFrom, map } from 'rxjs';

import { FOREPATH_CONTACT } from '../../forepath-contact.config';
import { ForepathProjectEstimateDebugPanelComponent } from './project-estimate-debug-panel.component';
import { ForepathProjectEstimateLoadingPanelComponent } from './project-estimate-loading-panel.component';

@Component({
  selector: 'framework-forepath-project-estimate',
  imports: [
    AsyncPipe,
    CurrencyPipe,
    FormsModule,
    ForepathProjectEstimateDebugPanelComponent,
    ForepathProjectEstimateLoadingPanelComponent,
    NgClass,
    RouterModule,
  ],
  styleUrls: ['./project-estimate.component.scss'],
  templateUrl: './project-estimate.component.html',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ForepathProjectEstimateComponent implements OnInit {
  @ViewChild('messageViewport') private messageViewport?: ElementRef<HTMLElement>;
  @ViewChild('promptInput') private promptInput?: ElementRef<HTMLTextAreaElement>;

  private readonly titleService = inject(Title);
  private readonly metaService = inject(Meta);
  private readonly environment = inject<Environment>(ENVIRONMENT);
  private readonly locale = inject(LOCALE_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly router = inject(Router);
  readonly facade = inject(ProjectEstimatorFacade);

  readonly contact = FOREPATH_CONTACT;
  readonly showDebugPanel = signal(false);
  readonly prompt = signal('');

  readonly isModelLoading = toSignal(this.facade.isModelLoading$, { initialValue: false });
  readonly isEstimating = toSignal(this.facade.isEstimating$, { initialValue: false });

  readonly overlayKind = computed<'warmup' | 'generating' | null>(() => {
    if (this.isModelLoading()) {
      return 'warmup';
    }

    if (this.isEstimating()) {
      return 'generating';
    }

    return null;
  });

  readonly showOverlay = computed(() => this.overlayKind() !== null);

  readonly canSubmit = toSignal(this.facade.canSubmit$, { initialValue: false });

  private readonly deviceCapability = toSignal(this.facade.deviceCapability$, {
    initialValue: 'pending' satisfies DeviceCapabilityStatus,
  });

  readonly isAwaitingGpuPermission = toSignal(this.facade.isAwaitingGpuPermission$, { initialValue: false });
  readonly isRequestingGpuAccess = toSignal(this.facade.isRequestingGpuAccess$, { initialValue: false });

  readonly isCheckingDevice = computed(() => {
    if (isPlatformServer(this.platformId)) {
      return true;
    }

    return this.deviceCapability() === 'checking';
  });

  readonly isDeviceUnsupported = computed(() => this.deviceCapability() === 'unsupported');

  readonly hasMessages = toSignal(this.facade.messages$.pipe(map((messages) => messages.length > 0)), {
    initialValue: false,
  });

  readonly hasEstimate = toSignal(this.facade.hasEstimate$, { initialValue: false });

  readonly activeMemoryProfileId = toSignal(this.facade.activeMemoryProfileId$, { initialValue: null });
  readonly deviceMaxMemoryProfileId = toSignal(this.facade.deviceMaxMemoryProfileId$, { initialValue: null });
  readonly isModelReady = toSignal(this.facade.isModelReady$, { initialValue: false });

  readonly showMemoryProfile = computed(
    () => this.isModelReady() && this.activeMemoryProfileId() !== null && this.deviceMaxMemoryProfileId() !== null,
  );

  readonly memoryProfileOptions = computed(() => {
    const activeProfileId = this.activeMemoryProfileId();
    const deviceMaxProfileId = this.deviceMaxMemoryProfileId();

    if (!activeProfileId || !deviceMaxProfileId) {
      return [];
    }

    return listMemoryProfileSwitcherOptions(activeProfileId, deviceMaxProfileId);
  });

  readonly showLiteProfileWarning = computed(() => this.showMemoryProfile() && this.activeMemoryProfileId() === 'lite');

  readonly hasHigherProfileAvailable = computed(() => {
    const deviceMaxProfileId = this.deviceMaxMemoryProfileId();

    return deviceMaxProfileId === 'balanced' || deviceMaxProfileId === 'standard';
  });

  readonly activeDebugPreset = signal<ProjectEstimatorDebugPreset | null>(null);

  ngOnInit(): void {
    const metaTitle = $localize`:@@featureForepathProjectEstimate-metaTitle:Instant quote :: ForePath`;
    const metaDescription = $localize`:@@featureForepathProjectEstimate-metaDescription:Describe your project and get an instant indicative quote from ForePath. Your project details stay private and are not sent to our servers.`;

    this.titleService.setTitle(metaTitle);
    this.destroyRef.onDestroy(
      addPageMetaTags(
        this.metaService,
        buildPageMetaTags({
          description: metaDescription,
          keywords: $localize`:@@featureForepathProjectEstimate-metaKeywords:ForePath instant quote, IT pricing calculator, software development quote, consulting quote`,
          author: 'IPvX UG (haftungsbeschränkt)',
          robots: 'index, follow',
          canonicalUrl: 'https://forepath.io/pricing/estimate',
          socialTitle: metaTitle,
          socialDescription: metaDescription,
          socialImageUrl: this.environment.socialPreview.imageUrl,
          localeId: this.locale,
          localizeCanonicalUrl: this.environment.production,
        }),
      ),
    );

    this.facade.initialize();
  }

  onPromptKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
      return;
    }

    event.preventDefault();
    this.submitPrompt();
  }

  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(event: KeyboardEvent): void {
    if (!event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) {
      return;
    }

    if (event.key.toLowerCase() !== 'e') {
      return;
    }

    event.preventDefault();
    this.showDebugPanel.update((visible) => !visible);
  }

  submitPrompt(): void {
    const description = this.prompt().trim();

    if (!description || !this.canSubmit() || this.showOverlay()) {
      return;
    }

    this.facade.submitDescription(description);
    this.prompt.set('');
    this.scrollMessagesToBottom();
  }

  scrollMessagesToBottom(): void {
    queueMicrotask(() => {
      const viewport = this.messageViewport?.nativeElement;

      if (viewport) {
        viewport.scrollTop = viewport.scrollHeight;
      }
    });
  }

  focusPrompt(): void {
    this.promptInput?.nativeElement.focus();
  }

  applyDebugPreset(preset: ProjectEstimatorDebugPreset): void {
    this.facade.setDebugState(preset);
    this.activeDebugPreset.set(preset);
  }

  startOver(): void {
    this.prompt.set('');
    this.facade.startOver();
    this.focusPrompt();
  }

  async contactAboutQuote(): Promise<void> {
    const estimate = await firstValueFrom(this.facade.currentEstimate$);

    if (!estimate) {
      return;
    }

    const messages = await firstValueFrom(this.facade.messages$);
    const userDescription = messages.find((message) => message.role === 'user')?.content ?? '';
    const message = formatProjectEstimateContactMessage({
      userDescription,
      estimate,
      labels: this.contactMessageLabels(),
      formatCurrency: (amount) => this.formatCurrency(amount),
    });

    storeContactMessagePrefill(message);
    await this.router.navigate(['/contact']);
  }

  private contactMessageLabels(): {
    intro: string;
    projectDescriptionHeading: string;
    summaryHeading: string;
    lineItemsHeading: string;
    subtotalLabel: string;
    assumptionsHeading: string;
  } {
    return {
      intro: $localize`:@@featureForepathProjectEstimate-contactPrefillIntro:I would like to discuss the following instant quote from ForePath.`,
      projectDescriptionHeading: $localize`:@@featureForepathProjectEstimate-contactPrefillProjectDescription:Project description`,
      summaryHeading: $localize`:@@featureForepathProjectEstimate-contactPrefillSummary:Summary`,
      lineItemsHeading: $localize`:@@featureForepathProjectEstimate-contactPrefillLineItems:Line items`,
      subtotalLabel: $localize`:@@featureForepathProjectEstimate-contactPrefillSubtotal:Subtotal (net):`,
      assumptionsHeading: $localize`:@@featureForepathProjectEstimate-contactPrefillAssumptions:Assumptions`,
    };
  }

  private formatCurrency(amount: number): string {
    return new Intl.NumberFormat(this.locale, {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  }

  profileIconClass(profileId: ForepathLlmMemoryProfileId): string {
    switch (profileId) {
      case 'lite':
        return 'bi-chevron-up';
      case 'balanced':
        return 'bi-chevron-bar-up';
      case 'standard':
        return 'bi-chevron-double-up';
    }
  }

  profileLabel(profileId: ForepathLlmMemoryProfileId): string {
    switch (profileId) {
      case 'lite':
        return $localize`:@@featureForepathProjectEstimate-profileLite:Lite`;
      case 'balanced':
        return $localize`:@@featureForepathProjectEstimate-profileBalanced:Balanced`;
      case 'standard':
        return $localize`:@@featureForepathProjectEstimate-profileStandard:Standard`;
    }
  }

  switchMemoryProfile(profileId: ForepathLlmMemoryProfileId): void {
    if (this.isEstimating() || this.isModelLoading()) {
      return;
    }

    this.facade.changeMemoryProfile(profileId);
  }

  runRealInitialize(): void {
    this.activeDebugPreset.set(null);
    this.facade.initialize();
  }

  requestGpuAccess(): void {
    if (this.isRequestingGpuAccess()) {
      return;
    }

    this.facade.requestGpuAccess();
  }
}
