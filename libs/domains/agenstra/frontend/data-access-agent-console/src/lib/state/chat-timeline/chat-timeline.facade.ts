import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import {
  chatEnhancementStarted,
  chatTimelineClear,
  chatTimelineRestoreRequested,
  ticketBodyGenerationStarted,
} from './chat-timeline.actions';
import {
  selectChatEnhancementLastResult,
  selectChatEnhancementPending,
  selectChatTimelineError,
  selectChatTimelineEvents,
  selectChatTimelineMessages,
  selectChatTimelineOrdered,
  selectHasMoreOlder,
  selectLoadingInitial,
  selectLoadingOlder,
  selectMessageFilterResults,
  selectOldestMessageId,
  selectTicketBodyGenerationPending,
  selectTicketBodyLastResult,
  type ChatTimelineOrderedRow,
} from './chat-timeline.selectors';
import type {
  ChatTimelineCorrelationResult,
  ChatTimelineEventRow,
  ChatTimelineFilterResult,
  ChatTimelineMessageRow,
} from './chat-timeline.types';

@Injectable({
  providedIn: 'root',
})
export class ChatTimelineFacade {
  private readonly store = inject(Store);

  readonly timelineOrdered$: Observable<ChatTimelineOrderedRow[]> = this.store.select(selectChatTimelineOrdered);
  readonly messages$: Observable<ChatTimelineMessageRow[]> = this.store.select(selectChatTimelineMessages);
  readonly events$: Observable<ChatTimelineEventRow[]> = this.store.select(selectChatTimelineEvents);
  readonly messageFilterResults$: Observable<ChatTimelineFilterResult[]> =
    this.store.select(selectMessageFilterResults);
  readonly hasMoreOlder$: Observable<boolean> = this.store.select(selectHasMoreOlder);
  readonly oldestMessageId$: Observable<string | null> = this.store.select(selectOldestMessageId);
  readonly loadingInitial$: Observable<boolean> = this.store.select(selectLoadingInitial);
  readonly loadingOlder$: Observable<boolean> = this.store.select(selectLoadingOlder);
  readonly error$: Observable<string | null> = this.store.select(selectChatTimelineError);
  readonly chatEnhancementPending$: Observable<boolean> = this.store.select(selectChatEnhancementPending);
  readonly chatEnhancementLastResult$: Observable<ChatTimelineCorrelationResult | null> = this.store.select(
    selectChatEnhancementLastResult,
  );
  readonly ticketBodyGenerationPending$: Observable<boolean> = this.store.select(selectTicketBodyGenerationPending);
  readonly ticketBodyLastResult$: Observable<ChatTimelineCorrelationResult | null> =
    this.store.select(selectTicketBodyLastResult);

  clear(): void {
    this.store.dispatch(chatTimelineClear());
  }

  restoreRequested(older: boolean): void {
    this.store.dispatch(chatTimelineRestoreRequested({ older }));
  }

  startEnhance(correlationId: string): void {
    this.store.dispatch(chatEnhancementStarted({ correlationId }));
  }

  startTicketBody(correlationId: string): void {
    this.store.dispatch(ticketBodyGenerationStarted({ correlationId }));
  }
}
