import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  LOCALE_ID,
  OnInit,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  CONTACT_FORM_FIELD_MAX_LENGTH,
  ContactRequestFacade,
} from '@forepath/shared/frontend/data-access-communication';
import { ENVIRONMENT, type Environment } from '@forepath/shared/frontend/util-configuration';
import { addPageMetaTags, buildPageMetaTags } from '@forepath/shared/frontend/util-meta';
import { NgxTurnstileComponent, NgxTurnstileModule } from 'ngx-turnstile';

import type { SharedContactPageConfig, SharedContactPageHeroTheme } from './contact-page.config';
import { SHARED_CONTACT_PAGE_DATA_KEY } from './contact-page.config';
import { readAndClearContactMessagePrefill } from './contact-message-prefill.storage';

@Component({
  selector: 'shared-contact-page',
  imports: [CommonModule, ReactiveFormsModule, RouterLink, NgxTurnstileModule],
  templateUrl: './contact-page.component.html',
  styleUrls: ['./contact-page.component.scss'],
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SharedContactPageComponent implements OnInit {
  @ViewChild(NgxTurnstileComponent)
  private turnstileWidget?: NgxTurnstileComponent;

  private readonly contactRequestFacade = inject(ContactRequestFacade);
  private readonly formBuilder = inject(FormBuilder);

  readonly submitting$ = this.contactRequestFacade.getSubmitting$();
  readonly submitted$ = this.contactRequestFacade.getSubmitted$();
  readonly error$ = this.contactRequestFacade.getError$();

  readonly turnstileSiteKey: string;
  readonly turnstileToken = signal<string | null>(null);

  readonly form = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(CONTACT_FORM_FIELD_MAX_LENGTH.name)]],
    email: ['', [Validators.required, Validators.email, Validators.maxLength(CONTACT_FORM_FIELD_MAX_LENGTH.email)]],
    message: [
      '',
      [Validators.required, Validators.minLength(1), Validators.maxLength(CONTACT_FORM_FIELD_MAX_LENGTH.message)],
    ],
    phone: ['', [Validators.maxLength(CONTACT_FORM_FIELD_MAX_LENGTH.phone)]],
    company: ['', [Validators.maxLength(CONTACT_FORM_FIELD_MAX_LENGTH.company)]],
    privacyPolicyAccepted: [false, Validators.requiredTrue],
  });

  private readonly titleService = inject(Title);
  private readonly metaService = inject(Meta);
  private readonly environment = inject<Environment>(ENVIRONMENT);
  private readonly locale = inject(LOCALE_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly pageConfig = this.route.snapshot.data[SHARED_CONTACT_PAGE_DATA_KEY] as SharedContactPageConfig;

  readonly heroTheme: SharedContactPageHeroTheme = this.pageConfig.heroTheme;
  readonly contactDetails = this.pageConfig.contactDetails;

  constructor() {
    this.turnstileSiteKey = this.environment.communication.turnstileSiteKey;
  }

  ngOnInit(): void {
    const pageConfig = this.pageConfig;
    const productName = this.environment.productName;
    const metaTitle = $localize`:@@sharedFeatureLandingpageContact-metaTitle:Contact :: ${productName}:productName:`;
    const metaDescription = $localize`:@@sharedFeatureLandingpageContact-metaDescription:Send us a message. We typically reply within one business day.`;

    this.titleService.setTitle(metaTitle);
    this.destroyRef.onDestroy(
      addPageMetaTags(
        this.metaService,
        buildPageMetaTags({
          description: metaDescription,
          keywords: $localize`:@@sharedFeatureLandingpageContact-metaKeywords:contact, support, ${productName}:productName:`,
          author: 'IPvX UG (haftungsbeschränkt)',
          robots: 'index, follow',
          canonicalUrl: pageConfig.canonicalUrl,
          socialTitle: metaTitle,
          socialDescription: metaDescription,
          socialImageUrl: this.environment.socialPreview.imageUrl,
          localeId: this.locale,
          localizeCanonicalUrl: this.environment.production,
        }),
      ),
    );

    this.error$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((error) => {
      if (error) {
        this.resetTurnstile();
      }
    });

    const prefillMessage = readAndClearContactMessagePrefill();

    if (prefillMessage) {
      this.form.patchValue({ message: prefillMessage });
    }
  }

  onTurnstileResolved(response: string | null): void {
    this.turnstileToken.set(response);
  }

  onSubmit(): void {
    if (this.form.invalid || !this.turnstileToken()) {
      this.form.markAllAsTouched();
      return;
    }

    const { name, email, message, phone, company } = this.form.getRawValue();
    const payload = {
      name: name.trim(),
      email: email.trim(),
      message: message.trim(),
      turnstileToken: this.turnstileToken() ?? '',
      ...(phone.trim() ? { phone: phone.trim() } : {}),
      ...(company.trim() ? { company: company.trim() } : {}),
    };

    this.contactRequestFacade.submit(payload);
  }

  private resetTurnstile(): void {
    this.turnstileToken.set(null);
    this.turnstileWidget?.reset();
  }
}
