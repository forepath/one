import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { PublicWithdrawalFacade } from '@forepath/decabill/frontend/data-access-billing-console';
import type {
  PublicWithdrawalAddressee,
  PublicWithdrawalStep,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { IdentityOtpInputComponent } from '@forepath/identity/frontend';
import { isAuthMarketingPanelVisible } from '@forepath/identity/frontend';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import type { Observable } from 'rxjs';

type DetailsForm = {
  subscriptionNumber: string;
  customerName: string;
  email: string;
  company: string;
  orderedOn: string;
  receivedOn: string;
};

type CodeForm = {
  code: string;
};

type AcknowledgeForm = {
  acknowledgeWithdrawal: boolean;
};

@Component({
  selector: 'framework-public-withdrawal',
  imports: [CommonModule, ReactiveFormsModule, RouterModule, IdentityOtpInputComponent],
  styleUrls: ['./public-withdrawal.component.scss'],
  templateUrl: './public-withdrawal.component.html',
  standalone: true,
})
export class PublicWithdrawalComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly publicWithdrawalFacade = inject(PublicWithdrawalFacade);
  protected readonly environment = inject(ENVIRONMENT);

  detailsForm!: FormGroup;
  codeForm!: FormGroup;
  acknowledgeForm!: FormGroup;
  formSubmitted = false;

  protected readonly productName = this.environment.productName;
  protected readonly authMarketing = this.environment.authMarketing;
  protected readonly showAuthMarketingPanel = isAuthMarketingPanelVisible(this.environment.authLayout);
  protected readonly requestId = toSignal(this.publicWithdrawalFacade.requestId$, { initialValue: null });

  readonly step$: Observable<PublicWithdrawalStep> = this.publicWithdrawalFacade.step$;
  readonly resumed$: Observable<boolean> = this.publicWithdrawalFacade.resumed$;
  readonly addressee$: Observable<PublicWithdrawalAddressee | null> = this.publicWithdrawalFacade.addressee$;
  readonly addresseeLoading$: Observable<boolean> = this.publicWithdrawalFacade.addresseeLoading$;
  readonly addresseeError$: Observable<string | null> = this.publicWithdrawalFacade.addresseeError$;
  readonly loading$: Observable<boolean> = this.publicWithdrawalFacade.loading$;
  readonly verifying$: Observable<boolean> = this.publicWithdrawalFacade.verifying$;
  readonly confirming$: Observable<boolean> = this.publicWithdrawalFacade.confirming$;
  readonly error$: Observable<string | null> = this.publicWithdrawalFacade.error$;
  readonly successMessage$: Observable<string | null> = this.publicWithdrawalFacade.successMessage$;

  ngOnInit(): void {
    this.publicWithdrawalFacade.loadAddressee();

    this.detailsForm = this.fb.group({
      subscriptionNumber: ['', [Validators.required, Validators.pattern(/^SUB-\d{6}$/i)]],
      customerName: ['', [Validators.required, Validators.maxLength(255)]],
      email: ['', [Validators.required, Validators.email]],
      company: ['', [Validators.maxLength(255)]],
      orderedOn: ['', [Validators.required]],
      receivedOn: [''],
    });

    this.codeForm = this.fb.group({
      code: ['', [Validators.required, Validators.pattern(/^[A-Z0-9]{6}$/)]],
    });

    this.acknowledgeForm = this.fb.group({
      acknowledgeWithdrawal: [false, [Validators.requiredTrue]],
    });

    this.step$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((step) => {
      this.formSubmitted = false;

      if (step === 'acknowledge') {
        this.acknowledgeForm.reset({ acknowledgeWithdrawal: false });
      }
    });
  }

  onSubmitDetails(): void {
    this.formSubmitted = true;

    if (this.detailsForm.invalid) {
      this.markAllTouched(this.detailsForm);
      return;
    }

    const value = this.detailsForm.getRawValue() as DetailsForm;

    this.publicWithdrawalFacade.requestWithdrawal({
      subscriptionNumber: value.subscriptionNumber.trim().toUpperCase(),
      customerName: value.customerName.trim(),
      email: value.email.trim(),
      company: value.company?.trim() || undefined,
      orderedOn: value.orderedOn,
      receivedOn: value.receivedOn?.trim() || undefined,
    });
  }

  onSubmitCode(): void {
    this.formSubmitted = true;

    if (this.codeForm.invalid) {
      this.markAllTouched(this.codeForm);
      return;
    }

    const requestId = this.requestId();

    if (!requestId) {
      return;
    }

    const code = (this.codeForm.get('code')?.value as string).trim().toUpperCase();

    this.publicWithdrawalFacade.verifyCode({ requestId, code });
  }

  onSubmitAcknowledge(): void {
    this.formSubmitted = true;

    if (this.acknowledgeForm.invalid) {
      this.markAllTouched(this.acknowledgeForm);
      return;
    }

    const requestId = this.requestId();

    if (!requestId) {
      return;
    }

    this.publicWithdrawalFacade.confirmWithdrawal({
      requestId,
      acknowledgeWithdrawal: true,
    });
  }

  onDismissError(): void {
    this.publicWithdrawalFacade.clearError();
  }

  onDismissSuccess(): void {
    this.publicWithdrawalFacade.clearSuccessMessage();
  }

  private markAllTouched(form: FormGroup): void {
    Object.keys(form.controls).forEach((key) => {
      form.get(key)?.markAsTouched();
    });
  }
}
