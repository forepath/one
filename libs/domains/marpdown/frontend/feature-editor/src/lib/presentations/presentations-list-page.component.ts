import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import {
  PresentationsFacade,
  createPresentationSuccess,
  deletePresentationSuccess,
} from '@forepath/marpdown/frontend/data-access-editor';
import { Actions, ofType } from '@ngrx/effects';

@Component({
  selector: 'marpdown-presentations-list-page',
  standalone: true,
  imports: [CommonModule, RouterModule, ReactiveFormsModule],
  templateUrl: './presentations-list-page.component.html',
  styleUrls: ['./presentations-list-page.component.scss'],
})
export class PresentationsListPageComponent implements OnInit {
  private readonly presentationsFacade = inject(PresentationsFacade);
  private readonly actions$ = inject(Actions);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  readonly presentations$ = this.presentationsFacade.presentations$;
  readonly loading$ = this.presentationsFacade.loading$;
  readonly creating$ = this.presentationsFacade.creating$;
  readonly error$ = this.presentationsFacade.error$;

  readonly createForm = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(500)]],
  });

  ngOnInit(): void {
    this.presentationsFacade.loadPresentations();

    this.actions$
      .pipe(ofType(createPresentationSuccess), takeUntilDestroyed(this.destroyRef))
      .subscribe(({ presentation }) => {
        this.createForm.reset();
        void this.router.navigate(['/presentations', presentation.id]);
      });

    this.actions$
      .pipe(ofType(deletePresentationSuccess), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.presentationsFacade.loadPresentations());
  }

  createPresentation(): void {
    if (this.createForm.invalid) {
      return;
    }

    this.presentationsFacade.createPresentation({ title: this.createForm.controls.title.value });
  }

  openPresentation(id: string): void {
    void this.router.navigate(['/presentations', id]);
  }

  deletePresentation(id: string): void {
    if (confirm('Delete this presentation?')) {
      this.presentationsFacade.deletePresentation(id);
    }
  }
}
