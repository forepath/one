import { CommonModule, ViewportScroller } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  Injector,
  LOCALE_ID,
  OnInit,
  signal,
  ViewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute, RouterModule } from '@angular/router';
import {
  CONTENT_REPORT_FIELD_MAX_LENGTH,
  CONTENT_REPORT_PDF_MAX_BYTES,
  type ContentReportLanguage,
  type ContentReportType,
  ContentReportFacade,
} from '@forepath/shared/frontend/data-access-communication';
import {
  FpcAlertComponent,
  FpcButtonComponent,
  FpcFormCheckComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
} from '@forepath/shared/frontend/ui-components';
import { ENVIRONMENT, type Environment } from '@forepath/shared/frontend/util-configuration';
import { addPageMetaTags, buildPageMetaTags } from '@forepath/shared/frontend/util-meta';
import { NgxTurnstileComponent, NgxTurnstileModule } from 'ngx-turnstile';

@Component({
  selector: 'framework-forepath-legal-content-report',
  imports: [
    CommonModule,
    RouterModule,
    ReactiveFormsModule,
    NgxTurnstileModule,
    FpcAlertComponent,
    FpcButtonComponent,
    FpcFormCheckComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
  ],
  styleUrls: ['./content-report.component.scss'],
  templateUrl: './content-report.component.html',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ForepathLegalContentReportComponent implements OnInit {
  @ViewChild(NgxTurnstileComponent)
  private turnstileWidget?: NgxTurnstileComponent;

  private readonly titleService = inject(Title);
  private readonly metaService = inject(Meta);
  private readonly environment = inject<Environment>(ENVIRONMENT);
  private readonly locale = inject(LOCALE_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly formBuilder = inject(FormBuilder);
  private readonly contentReportFacade = inject(ContentReportFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly viewportScroller = inject(ViewportScroller);
  private readonly injector = inject(Injector);

  readonly submitting$ = this.contentReportFacade.getSubmitting$();
  readonly submitted$ = this.contentReportFacade.getSubmitted$();
  readonly error$ = this.contentReportFacade.getError$();

  readonly turnstileSiteKey: string;
  readonly turnstileToken = signal<string | null>(null);
  readonly selectedPdfError = signal<string | null>(null);
  readonly hasSelectedPdf = signal(false);
  readonly selectedReportType = signal<ContentReportType>('dsa');
  private selectedPdf: File | null = null;

  readonly anonymousNamePlaceholder = $localize`:@@featureForepathLegalContentReport-formNameAnonymousPlaceholder:Waived`;
  readonly anonymousEmailPlaceholder = $localize`:@@featureForepathLegalContentReport-formEmailAnonymousPlaceholder:Waived`;

  readonly form = this.formBuilder.nonNullable.group({
    reportType: ['dsa' as ContentReportType, [Validators.required]],
    name: ['', [Validators.maxLength(CONTENT_REPORT_FIELD_MAX_LENGTH.name)]],
    email: ['', [Validators.email, Validators.maxLength(CONTENT_REPORT_FIELD_MAX_LENGTH.email)]],
    contentUrls: [
      '',
      [Validators.required, Validators.minLength(1), Validators.maxLength(CONTENT_REPORT_FIELD_MAX_LENGTH.contentUrls)],
    ],
    explanation: ['', [Validators.maxLength(CONTENT_REPORT_FIELD_MAX_LENGTH.explanation)]],
    additionalIdentifiers: ['', [Validators.maxLength(CONTENT_REPORT_FIELD_MAX_LENGTH.additionalIdentifiers)]],
    illegalContentCategory: ['', [Validators.maxLength(CONTENT_REPORT_FIELD_MAX_LENGTH.illegalContentCategory)]],
    csamAnonymous: [false],
    goodFaithConfirmed: [false],
    authorityName: ['', [Validators.maxLength(CONTENT_REPORT_FIELD_MAX_LENGTH.authorityName)]],
    memberState: ['', [Validators.maxLength(CONTENT_REPORT_FIELD_MAX_LENGTH.memberState)]],
    officialName: ['', [Validators.maxLength(CONTENT_REPORT_FIELD_MAX_LENGTH.officialName)]],
    officialRole: ['', [Validators.maxLength(CONTENT_REPORT_FIELD_MAX_LENGTH.officialRole)]],
    orderReference: ['', [Validators.maxLength(CONTENT_REPORT_FIELD_MAX_LENGTH.orderReference)]],
    orderIssuedAt: ['', [Validators.maxLength(CONTENT_REPORT_FIELD_MAX_LENGTH.orderIssuedAt)]],
    statementOfReasons: ['', [Validators.maxLength(CONTENT_REPORT_FIELD_MAX_LENGTH.statementOfReasons)]],
    redressInformation: ['', [Validators.maxLength(CONTENT_REPORT_FIELD_MAX_LENGTH.redressInformation)]],
    preferredLanguage: ['' as ContentReportLanguage | ''],
    emergencyCase: [false],
    authorityAttestation: [false],
    privacyPolicyAccepted: [false, Validators.requiredTrue],
  });

  constructor() {
    this.turnstileSiteKey = this.environment.communication.turnstileSiteKey;
  }

  ngOnInit(): void {
    const metaTitle = $localize`:@@featureForepathLegalContentReport-metaTitle:Content Report :: ForePath`;
    const metaDescription = $localize`:@@featureForepathLegalContentReport-metaDescription:Report illegal content under the Digital Services Act or submit an official TCO removal order to IPvX UG (haftungsbeschränkt).`;

    this.titleService.setTitle(metaTitle);
    this.destroyRef.onDestroy(
      addPageMetaTags(
        this.metaService,
        buildPageMetaTags({
          description: metaDescription,
          keywords: $localize`:@@featureForepathLegalContentReport-metaKeywords:ForePath, DSA, TCO, content report, illegal content`,
          author: 'IPvX UG (haftungsbeschränkt)',
          robots: 'index, follow',
          canonicalUrl: 'https://forepath.io/legal/content-report',
          socialTitle: metaTitle,
          socialDescription: metaDescription,
          socialImageUrl: this.environment.socialPreview.imageUrl,
          localeId: this.locale,
          localizeCanonicalUrl: this.environment.production,
        }),
      ),
    );

    this.form.controls.reportType.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((reportType) => {
      this.selectedReportType.set(reportType);
      this.applyConditionalValidators();
      this.clearPdf();
    });
    this.form.controls.csamAnonymous.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.applyConditionalValidators();
    });
    this.applyConditionalValidators();
    this.selectedReportType.set(this.form.controls.reportType.value);

    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      this.applyTypeQueryParam(params.get('type'), true);
    });

    this.error$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((error) => {
      if (error) {
        this.resetTurnstile();
      }
    });
  }

  private applyTypeQueryParam(type: string | null, scrollToForm: boolean): void {
    if (type !== 'dsa' && type !== 'tco') {
      return;
    }

    if (this.form.controls.reportType.value !== type) {
      this.form.controls.reportType.setValue(type);
    } else {
      this.selectedReportType.set(type);
      this.applyConditionalValidators();
    }

    if (!scrollToForm) {
      return;
    }

    afterNextRender(
      () => {
        this.viewportScroller.scrollToAnchor('report-form');
      },
      { injector: this.injector },
    );
  }

  get isDsa(): boolean {
    return this.selectedReportType() === 'dsa';
  }

  get isTco(): boolean {
    return this.selectedReportType() === 'tco';
  }

  get isAnonymousDsa(): boolean {
    return this.isDsa && this.form.controls.csamAnonymous.value;
  }

  onTurnstileResolved(response: string | null): void {
    this.turnstileToken.set(response);
  }

  onPdfFilesChange(files: FileList | null): void {
    const file = files?.[0] ?? null;

    this.selectedPdfError.set(null);

    if (!file) {
      this.clearPdf();
      return;
    }

    if (file.type !== 'application/pdf' || !file.name.toLowerCase().endsWith('.pdf')) {
      this.selectedPdfError.set('Only PDF files are allowed.');
      this.clearPdf();
      return;
    }

    if (file.size <= 0 || file.size > CONTENT_REPORT_PDF_MAX_BYTES) {
      this.selectedPdfError.set('PDF must be at most 10 MiB.');
      this.clearPdf();
      return;
    }

    this.selectedPdf = file;
    this.hasSelectedPdf.set(true);
  }

  onSubmit(): void {
    this.applyConditionalValidators();

    if (this.form.invalid || !this.turnstileToken()) {
      this.form.markAllAsTouched();
      return;
    }

    if (this.isTco && !this.selectedPdf) {
      this.selectedPdfError.set('A signed removal-order PDF is required.');
      return;
    }

    const value = this.form.getRawValue();

    this.contentReportFacade.submit({
      reportType: value.reportType,
      turnstileToken: this.turnstileToken() ?? '',
      contentUrls: value.contentUrls.trim(),
      ...(this.isAnonymousDsa
        ? { csamAnonymous: true }
        : {
            name: value.name.trim(),
            email: value.email.trim(),
          }),
      ...(this.isDsa
        ? {
            explanation: value.explanation.trim(),
            goodFaithConfirmed: value.goodFaithConfirmed,
            csamAnonymous: value.csamAnonymous,
            ...(value.additionalIdentifiers.trim()
              ? { additionalIdentifiers: value.additionalIdentifiers.trim() }
              : {}),
            ...(value.illegalContentCategory.trim()
              ? { illegalContentCategory: value.illegalContentCategory.trim() }
              : {}),
          }
        : {
            authorityName: value.authorityName.trim(),
            memberState: value.memberState.trim(),
            officialName: value.officialName.trim(),
            officialRole: value.officialRole.trim(),
            orderReference: value.orderReference.trim(),
            orderIssuedAt: value.orderIssuedAt.trim(),
            statementOfReasons: value.statementOfReasons.trim(),
            redressInformation: value.redressInformation.trim(),
            preferredLanguage: value.preferredLanguage as ContentReportLanguage,
            emergencyCase: value.emergencyCase,
            authorityAttestation: value.authorityAttestation,
            removalOrderPdf: this.selectedPdf ?? undefined,
          }),
    });
  }

  private applyConditionalValidators(): void {
    const {
      name,
      email,
      explanation,
      goodFaithConfirmed,
      authorityName,
      memberState,
      officialName,
      officialRole,
      orderReference,
      orderIssuedAt,
      statementOfReasons,
      redressInformation,
      preferredLanguage,
      authorityAttestation,
      csamAnonymous,
      reportType,
    } = this.form.controls;

    const requireIdentity = reportType.value === 'tco' || !csamAnonymous.value;
    const waiveIdentity = reportType.value === 'dsa' && csamAnonymous.value;

    name.setValidators(
      requireIdentity
        ? [Validators.required, Validators.maxLength(CONTENT_REPORT_FIELD_MAX_LENGTH.name)]
        : [Validators.maxLength(CONTENT_REPORT_FIELD_MAX_LENGTH.name)],
    );
    email.setValidators(
      requireIdentity
        ? [Validators.required, Validators.email, Validators.maxLength(CONTENT_REPORT_FIELD_MAX_LENGTH.email)]
        : [Validators.email, Validators.maxLength(CONTENT_REPORT_FIELD_MAX_LENGTH.email)],
    );

    if (waiveIdentity) {
      name.setValue('', { emitEvent: false });
      email.setValue('', { emitEvent: false });
      name.disable({ emitEvent: false });
      email.disable({ emitEvent: false });
      name.markAsPristine();
      name.markAsUntouched();
      email.markAsPristine();
      email.markAsUntouched();
    } else {
      const wasDisabled = name.disabled || email.disabled;
      name.enable({ emitEvent: false });
      email.enable({ emitEvent: false });

      if (wasDisabled) {
        name.markAsPristine();
        name.markAsUntouched();
        email.markAsPristine();
        email.markAsUntouched();
      }
    }

    if (reportType.value === 'dsa') {
      explanation.setValidators([
        Validators.required,
        Validators.minLength(1),
        Validators.maxLength(CONTENT_REPORT_FIELD_MAX_LENGTH.explanation),
      ]);
      goodFaithConfirmed.setValidators([Validators.requiredTrue]);
      authorityName.clearValidators();
      memberState.clearValidators();
      officialName.clearValidators();
      officialRole.clearValidators();
      orderReference.clearValidators();
      orderIssuedAt.clearValidators();
      statementOfReasons.clearValidators();
      redressInformation.clearValidators();
      preferredLanguage.clearValidators();
      authorityAttestation.clearValidators();
    } else {
      explanation.clearValidators();
      goodFaithConfirmed.clearValidators();
      authorityName.setValidators([
        Validators.required,
        Validators.maxLength(CONTENT_REPORT_FIELD_MAX_LENGTH.authorityName),
      ]);
      memberState.setValidators([
        Validators.required,
        Validators.maxLength(CONTENT_REPORT_FIELD_MAX_LENGTH.memberState),
      ]);
      officialName.setValidators([
        Validators.required,
        Validators.maxLength(CONTENT_REPORT_FIELD_MAX_LENGTH.officialName),
      ]);
      officialRole.setValidators([
        Validators.required,
        Validators.maxLength(CONTENT_REPORT_FIELD_MAX_LENGTH.officialRole),
      ]);
      orderReference.setValidators([
        Validators.required,
        Validators.maxLength(CONTENT_REPORT_FIELD_MAX_LENGTH.orderReference),
      ]);
      orderIssuedAt.setValidators([
        Validators.required,
        Validators.maxLength(CONTENT_REPORT_FIELD_MAX_LENGTH.orderIssuedAt),
      ]);
      statementOfReasons.setValidators([
        Validators.required,
        Validators.minLength(1),
        Validators.maxLength(CONTENT_REPORT_FIELD_MAX_LENGTH.statementOfReasons),
      ]);
      redressInformation.setValidators([
        Validators.required,
        Validators.minLength(1),
        Validators.maxLength(CONTENT_REPORT_FIELD_MAX_LENGTH.redressInformation),
      ]);
      preferredLanguage.setValidators([Validators.required]);
      authorityAttestation.setValidators([Validators.requiredTrue]);
    }

    for (const control of [
      name,
      email,
      explanation,
      goodFaithConfirmed,
      authorityName,
      memberState,
      officialName,
      officialRole,
      orderReference,
      orderIssuedAt,
      statementOfReasons,
      redressInformation,
      preferredLanguage,
      authorityAttestation,
    ]) {
      control.updateValueAndValidity({ emitEvent: false });
    }
  }

  private clearPdf(): void {
    this.selectedPdf = null;
    this.hasSelectedPdf.set(false);
  }

  private resetTurnstile(): void {
    this.turnstileToken.set(null);
    this.turnstileWidget?.reset();
  }
}
