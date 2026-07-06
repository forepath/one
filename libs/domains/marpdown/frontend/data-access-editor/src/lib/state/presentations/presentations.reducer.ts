import { createReducer, on } from '@ngrx/store';

import type { PresentationResponseDto, PresentationSummaryDto } from '../../types/presentation.types';

import {
  clearActivePresentation,
  createPresentation,
  createPresentationFailure,
  createPresentationSuccess,
  deletePresentation,
  deletePresentationFailure,
  deletePresentationSuccess,
  importPresentationMarkdown,
  importPresentationMarkdownFailure,
  importPresentationMarkdownSuccess,
  loadPresentation,
  loadPresentationFailure,
  loadPresentations,
  loadPresentationsBatch,
  loadPresentationsFailure,
  loadPresentationsSuccess,
  loadPresentationSuccess,
  setActivePresentation,
  updatePresentation,
  updatePresentationFailure,
  updatePresentationSuccess,
} from './presentations.actions';

export interface PresentationsState {
  entities: PresentationSummaryDto[];
  total: number;
  selectedPresentation: PresentationResponseDto | null;
  activePresentationId: string | null;
  loading: boolean;
  loadingPresentation: boolean;
  creating: boolean;
  updating: boolean;
  deleting: boolean;
  importing: boolean;
  error: string | null;
}

export const initialPresentationsState: PresentationsState = {
  entities: [],
  total: 0,
  selectedPresentation: null,
  activePresentationId: null,
  loading: false,
  loadingPresentation: false,
  creating: false,
  updating: false,
  deleting: false,
  importing: false,
  error: null,
};

function upsertSummary(entities: PresentationSummaryDto[], presentation: PresentationSummaryDto): PresentationSummaryDto[] {
  const index = entities.findIndex((item) => item.id === presentation.id);

  if (index >= 0) {
    return entities.map((item) => (item.id === presentation.id ? presentation : item));
  }

  return [...entities, presentation];
}

export const presentationsReducer = createReducer(
  initialPresentationsState,
  on(loadPresentations, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),
  on(loadPresentationsBatch, (state, { accumulatedPresentations, total }) => ({
    ...state,
    entities: accumulatedPresentations,
    total,
    loading: true,
    error: null,
  })),
  on(loadPresentationsSuccess, (state, { presentations, total }) => ({
    ...state,
    entities: presentations,
    total,
    loading: false,
    error: null,
  })),
  on(loadPresentationsFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),
  on(loadPresentation, (state) => ({
    ...state,
    loadingPresentation: true,
    error: null,
  })),
  on(loadPresentationSuccess, (state, { presentation }) => ({
    ...state,
    selectedPresentation: presentation,
    entities: upsertSummary(state.entities, presentation),
    loadingPresentation: false,
    error: null,
  })),
  on(loadPresentationFailure, (state, { error }) => ({
    ...state,
    loadingPresentation: false,
    error,
  })),
  on(createPresentation, (state) => ({
    ...state,
    creating: true,
    error: null,
  })),
  on(createPresentationSuccess, (state, { presentation }) => ({
    ...state,
    entities: upsertSummary(state.entities, presentation),
    selectedPresentation: presentation,
    total: state.total + 1,
    creating: false,
    error: null,
  })),
  on(createPresentationFailure, (state, { error }) => ({
    ...state,
    creating: false,
    error,
  })),
  on(updatePresentation, (state) => ({
    ...state,
    updating: true,
    error: null,
  })),
  on(updatePresentationSuccess, (state, { presentation }) => ({
    ...state,
    entities: upsertSummary(state.entities, presentation),
    selectedPresentation: state.selectedPresentation?.id === presentation.id ? presentation : state.selectedPresentation,
    updating: false,
    error: null,
  })),
  on(updatePresentationFailure, (state, { error }) => ({
    ...state,
    updating: false,
    error,
  })),
  on(importPresentationMarkdown, (state) => ({
    ...state,
    importing: true,
    error: null,
  })),
  on(importPresentationMarkdownSuccess, (state, { presentation }) => ({
    ...state,
    entities: upsertSummary(state.entities, presentation),
    selectedPresentation: presentation,
    importing: false,
    error: null,
  })),
  on(importPresentationMarkdownFailure, (state, { error }) => ({
    ...state,
    importing: false,
    error,
  })),
  on(deletePresentation, (state) => ({
    ...state,
    deleting: true,
    error: null,
  })),
  on(deletePresentationSuccess, (state, { id }) => ({
    ...state,
    entities: state.entities.filter((item) => item.id !== id),
    selectedPresentation: state.selectedPresentation?.id === id ? null : state.selectedPresentation,
    activePresentationId: state.activePresentationId === id ? null : state.activePresentationId,
    total: Math.max(0, state.total - 1),
    deleting: false,
    error: null,
  })),
  on(deletePresentationFailure, (state, { error }) => ({
    ...state,
    deleting: false,
    error,
  })),
  on(setActivePresentation, (state, { id }) => ({
    ...state,
    activePresentationId: id,
    error: null,
  })),
  on(clearActivePresentation, (state) => ({
    ...state,
    activePresentationId: null,
    error: null,
  })),
);
