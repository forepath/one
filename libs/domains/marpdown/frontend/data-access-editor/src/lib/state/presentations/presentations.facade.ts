import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import type {
  CreatePresentationDto,
  ImportPresentationDto,
  ListPresentationsParams,
  PresentationResponseDto,
  PresentationSummaryDto,
  UpdatePresentationDto,
} from '../../types/presentation.types';

import {
  clearActivePresentation,
  createPresentation,
  deletePresentation,
  importPresentationMarkdown,
  loadPresentation,
  loadPresentations,
  setActivePresentation,
  updatePresentation,
} from './presentations.actions';
import {
  selectActivePresentation,
  selectActivePresentationId,
  selectHasPresentations,
  selectPresentationById,
  selectPresentationCreating,
  selectPresentationDeleting,
  selectPresentationImporting,
  selectPresentationLoading,
  selectPresentations,
  selectPresentationsError,
  selectPresentationsLoading,
  selectPresentationsLoadingAny,
  selectPresentationsTotal,
  selectPresentationUpdating,
  selectSelectedPresentation,
} from './presentations.selectors';

@Injectable({
  providedIn: 'root',
})
export class PresentationsFacade {
  private readonly store = inject(Store);

  readonly presentations$: Observable<PresentationSummaryDto[]> = this.store.select(selectPresentations);
  readonly total$: Observable<number> = this.store.select(selectPresentationsTotal);
  readonly selectedPresentation$: Observable<PresentationResponseDto | null> = this.store.select(selectSelectedPresentation);
  readonly activePresentationId$: Observable<string | null> = this.store.select(selectActivePresentationId);
  readonly activePresentation$: Observable<PresentationSummaryDto | null> = this.store.select(selectActivePresentation);
  readonly loading$: Observable<boolean> = this.store.select(selectPresentationsLoading);
  readonly loadingPresentation$: Observable<boolean> = this.store.select(selectPresentationLoading);
  readonly creating$: Observable<boolean> = this.store.select(selectPresentationCreating);
  readonly updating$: Observable<boolean> = this.store.select(selectPresentationUpdating);
  readonly deleting$: Observable<boolean> = this.store.select(selectPresentationDeleting);
  readonly importing$: Observable<boolean> = this.store.select(selectPresentationImporting);
  readonly loadingAny$: Observable<boolean> = this.store.select(selectPresentationsLoadingAny);
  readonly error$: Observable<string | null> = this.store.select(selectPresentationsError);
  readonly hasPresentations$: Observable<boolean> = this.store.select(selectHasPresentations);

  loadPresentations(params?: ListPresentationsParams): void {
    this.store.dispatch(loadPresentations({ params }));
  }

  loadPresentation(id: string): void {
    this.store.dispatch(loadPresentation({ id }));
  }

  createPresentation(dto: CreatePresentationDto): void {
    this.store.dispatch(createPresentation({ dto }));
  }

  updatePresentation(id: string, dto: UpdatePresentationDto): void {
    this.store.dispatch(updatePresentation({ id, dto }));
  }

  importMarkdown(id: string, dto: ImportPresentationDto): void {
    this.store.dispatch(importPresentationMarkdown({ id, dto }));
  }

  deletePresentation(id: string): void {
    this.store.dispatch(deletePresentation({ id }));
  }

  setActivePresentation(id: string): void {
    this.store.dispatch(setActivePresentation({ id }));
  }

  clearActivePresentation(): void {
    this.store.dispatch(clearActivePresentation());
  }

  getPresentationById$(id: string): Observable<PresentationSummaryDto | null> {
    return this.store.select(selectPresentationById(id));
  }
}
