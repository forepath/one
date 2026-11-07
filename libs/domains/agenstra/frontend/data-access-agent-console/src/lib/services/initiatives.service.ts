import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/agenstra/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/agenstra/frontend/util-configuration';
import { Observable, map } from 'rxjs';

import type {
  InitiativeActivityDto,
  InitiativeArtifactDto,
  InitiativeArtifactVersionDto,
  InitiativeBuildActionDto,
  InitiativeCommand,
  InitiativeCommandResult,
  InitiativeDecisionDto,
  InitiativeDto,
  InitiativeFindingDto,
  InitiativeListResponseDto,
  InitiativeOverviewDto,
  InitiativeProposalDto,
  InitiativeRunDto,
  InitiativeUnknownDto,
  InitiativeWorkItemsDto,
  TicketInitiativeLinkDto,
} from '../state/initiatives/initiatives.types';

/** Initiatives of a workspace (agent-controller REST). Live updates arrive on the `initiatives` socket. */
@Injectable({
  providedIn: 'root',
})
export class InitiativesService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  private get apiUrl(): string {
    return this.environment.console.urls.restApi;
  }

  list(
    clientId: string,
    query: { search?: string; state?: string; limit?: number; offset?: number } = {},
  ): Observable<InitiativeListResponseDto> {
    let params = new HttpParams().set('clientId', clientId);

    if (query.search?.trim()) params = params.set('search', query.search.trim());
    if (query.state) params = params.set('state', query.state);
    if (query.limit !== undefined) params = params.set('limit', String(query.limit));
    if (query.offset !== undefined) params = params.set('offset', String(query.offset));

    return this.http.get<InitiativeListResponseDto>(`${this.apiUrl}/initiatives`, { params });
  }

  get(id: string): Observable<InitiativeDto> {
    return this.http.get<InitiativeDto>(`${this.apiUrl}/initiatives/${id}`);
  }

  overview(id: string): Observable<InitiativeOverviewDto> {
    return this.http.get<InitiativeOverviewDto>(`${this.apiUrl}/initiatives/${id}/overview`);
  }

  artifacts(id: string): Observable<InitiativeArtifactDto[]> {
    return this.http.get<InitiativeArtifactDto[]>(`${this.apiUrl}/initiatives/${id}/artifacts`);
  }

  artifact(artifactId: string): Observable<InitiativeArtifactDto> {
    return this.http.get<InitiativeArtifactDto>(`${this.apiUrl}/initiative-artifacts/${artifactId}`);
  }

  artifactVersions(artifactId: string): Observable<InitiativeArtifactVersionDto[]> {
    return this.http.get<InitiativeArtifactVersionDto[]>(`${this.apiUrl}/initiative-artifacts/${artifactId}/versions`);
  }

  artifactVersion(artifactId: string, version: number): Observable<InitiativeArtifactVersionDto> {
    return this.http.get<InitiativeArtifactVersionDto>(
      `${this.apiUrl}/initiative-artifacts/${artifactId}/versions/${version}`,
    );
  }

  workItems(id: string): Observable<InitiativeWorkItemsDto> {
    return this.http.get<InitiativeWorkItemsDto>(`${this.apiUrl}/initiatives/${id}/work-items`);
  }

  runs(id: string): Observable<InitiativeRunDto[]> {
    return this.http.get<InitiativeRunDto[]>(`${this.apiUrl}/initiatives/${id}/runs`);
  }

  run(runId: string): Observable<InitiativeRunDto> {
    return this.http.get<InitiativeRunDto>(`${this.apiUrl}/initiative-runs/${runId}`);
  }

  proposals(id: string): Observable<InitiativeProposalDto[]> {
    return this.http.get<InitiativeProposalDto[]>(`${this.apiUrl}/initiatives/${id}/proposals`);
  }

  findings(id: string): Observable<InitiativeFindingDto[]> {
    return this.http.get<InitiativeFindingDto[]>(`${this.apiUrl}/initiatives/${id}/findings`);
  }

  decisions(id: string): Observable<InitiativeDecisionDto[]> {
    return this.http.get<InitiativeDecisionDto[]>(`${this.apiUrl}/initiatives/${id}/decisions`);
  }

  activity(id: string, limit = 100): Observable<InitiativeActivityDto[]> {
    return this.http.get<InitiativeActivityDto[]>(`${this.apiUrl}/initiatives/${id}/activity`, {
      params: new HttpParams().set('limit', String(limit)),
    });
  }

  /** Ticket board chip: the initiative story a ticket was transferred from. */
  ticketLink(ticketId: string): Observable<TicketInitiativeLinkDto> {
    return this.http.get<TicketInitiativeLinkDto>(`${this.apiUrl}/tickets/${ticketId}/initiative-link`);
  }

  /** One REST call per command; the result tells the reducer what changed. */
  execute(command: InitiativeCommand): Observable<InitiativeCommandResult> {
    const api = this.apiUrl;

    switch (command.type) {
      case 'createInitiative':
        return this.http
          .post<InitiativeDto>(`${api}/initiatives`, command.dto)
          .pipe(map((initiative) => ({ kind: 'initiative', initiative })));
      case 'updateInitiative':
        return this.http
          .patch<InitiativeDto>(`${api}/initiatives/${command.id}`, command.dto)
          .pipe(map((initiative) => ({ kind: 'initiative', initiative })));
      case 'deleteInitiative':
        return this.http
          .delete<void>(`${api}/initiatives/${command.id}`)
          .pipe(map(() => ({ kind: 'initiativeRemoved', id: command.id })));
      case 'startIteration':
        return this.http
          .post<InitiativeDto>(`${api}/initiatives/${command.id}/iterations`, {
            expectedVersion: command.expectedVersion,
          })
          .pipe(map((initiative) => ({ kind: 'initiative', initiative })));
      case 'createArtifact':
        return this.http
          .post<InitiativeArtifactDto>(`${api}/initiatives/${command.initiativeId}/artifacts`, command.dto)
          .pipe(map((artifact) => ({ kind: 'artifact', artifact })));
      case 'updateArtifact':
        return this.http
          .patch<InitiativeArtifactDto>(`${api}/initiative-artifacts/${command.artifactId}`, command.dto)
          .pipe(map((artifact) => ({ kind: 'artifact', artifact })));
      case 'acceptArtifact':
        return this.http
          .post<InitiativeArtifactDto>(`${api}/initiative-artifacts/${command.artifactId}/accept`, {
            expectedVersion: command.expectedVersion,
          })
          .pipe(map((artifact) => ({ kind: 'artifact', artifact })));
      case 'deleteArtifact':
        return this.http
          .delete<void>(`${api}/initiative-artifacts/${command.artifactId}`)
          .pipe(map(() => ({ kind: 'artifactRemoved', id: command.artifactId, initiativeId: command.initiativeId })));
      case 'publishArtifact':
        return this.http
          .post<InitiativeArtifactDto>(
            `${api}/initiative-artifacts/${command.artifactId}/publish`,
            command.parentNodeId ? { parentNodeId: command.parentNodeId } : {},
          )
          .pipe(map((artifact) => ({ kind: 'artifact', artifact })));
      case 'createWorkItem':
        return this.workItemsResult(
          this.http.post<InitiativeWorkItemsDto>(`${api}/initiatives/${command.initiativeId}/work-items`, command.dto),
        );
      case 'updateWorkItem':
        return this.workItemsResult(
          this.http.patch<InitiativeWorkItemsDto>(`${api}/initiative-work-items/${command.itemId}`, command.dto),
        );
      case 'deleteWorkItem':
        return this.workItemsResult(
          this.http.delete<InitiativeWorkItemsDto>(`${api}/initiative-work-items/${command.itemId}`),
        );
      case 'reorderWorkItem':
        return this.workItemsResult(
          this.http.post<InitiativeWorkItemsDto>(`${api}/initiative-work-items/${command.itemId}/reorder`, {
            expectedInitiativeVersion: command.expectedInitiativeVersion,
            ...(command.beforeId ? { beforeId: command.beforeId } : {}),
          }),
        );
      case 'setDependencies':
        return this.workItemsResult(
          this.http.put<InitiativeWorkItemsDto>(`${api}/initiative-work-items/${command.itemId}/dependencies`, {
            expectedInitiativeVersion: command.expectedInitiativeVersion,
            prerequisiteIds: command.prerequisiteIds,
          }),
        );
      case 'setWorkItemStatus':
        return this.workItemsResult(
          this.http.post<InitiativeWorkItemsDto>(`${api}/initiative-work-items/${command.itemId}/status`, {
            status: command.status,
          }),
        );
      case 'overrideRetrospective':
        return this.workItemsResult(
          this.http.post<InitiativeWorkItemsDto>(
            `${api}/initiative-work-items/${command.itemId}/retrospective-verdict`,
            { verdict: command.verdict },
          ),
        );
      case 'createUnknown':
        return this.http
          .post<InitiativeUnknownDto>(`${api}/initiatives/${command.initiativeId}/unknowns`, command.dto)
          .pipe(map(() => ({ kind: 'unknown', initiativeId: command.initiativeId })));
      case 'resolveUnknown':
        return this.http
          .post<InitiativeUnknownDto>(`${api}/initiative-unknowns/${command.unknownId}/resolve`, {
            answer: command.answer,
          })
          .pipe(map(() => ({ kind: 'unknown', initiativeId: command.initiativeId })));
      case 'deleteUnknown':
        return this.http
          .delete<void>(`${api}/initiative-unknowns/${command.unknownId}`)
          .pipe(map(() => ({ kind: 'unknown', initiativeId: command.initiativeId })));
      case 'transfer':
        return this.http
          .post<InitiativeBuildActionDto>(`${api}/initiatives/${command.initiativeId}/transfer`, command.dto)
          .pipe(map((result) => ({ kind: 'build', initiativeId: command.initiativeId, result })));
      case 'release':
        return this.http
          .post<InitiativeBuildActionDto>(
            `${api}/initiatives/${command.initiativeId}/release`,
            command.workItemIds ? { workItemIds: command.workItemIds } : {},
          )
          .pipe(map((result) => ({ kind: 'build', initiativeId: command.initiativeId, result })));
      case 'planStory':
        return this.http
          .post<InitiativeBuildActionDto>(`${api}/initiative-work-items/${command.itemId}/plan`, command.dto)
          .pipe(map((result) => ({ kind: 'build', initiativeId: result.workItems[0]?.initiativeId ?? '', result })));
      case 'startRun':
        return this.http
          .post<InitiativeRunDto>(`${api}/initiatives/${command.initiativeId}/runs`, command.dto)
          .pipe(map((run) => ({ kind: 'run', run })));
      case 'messageRun':
        return this.http
          .post<InitiativeRunDto>(`${api}/initiative-runs/${command.runId}/messages`, { message: command.message })
          .pipe(map((run) => ({ kind: 'run', run })));
      case 'acceptRun':
      case 'discardRun':
      case 'cancelRun': {
        const action = command.type === 'acceptRun' ? 'accept' : command.type === 'discardRun' ? 'discard' : 'cancel';

        return this.http
          .post<InitiativeRunDto>(`${api}/initiative-runs/${command.runId}/${action}`, {
            expectedVersion: command.expectedVersion,
          })
          .pipe(map((run) => ({ kind: 'run', run })));
      }
      case 'retryRun':
        return this.http
          .post<InitiativeRunDto>(`${api}/initiative-runs/${command.runId}/retry`, {})
          .pipe(map((run) => ({ kind: 'run', run })));
      case 'createFinding':
        return this.http
          .post<InitiativeFindingDto>(`${api}/initiatives/${command.initiativeId}/findings`, command.dto)
          .pipe(map((finding) => ({ kind: 'finding', finding })));
      case 'updateFinding':
        return this.http
          .patch<InitiativeFindingDto>(`${api}/initiative-findings/${command.findingId}`, { status: command.status })
          .pipe(map((finding) => ({ kind: 'finding', finding })));
      case 'convertFinding':
        return this.http
          .post<InitiativeFindingDto>(`${api}/initiative-findings/${command.findingId}/convert`, {
            epicId: command.epicId,
            ...(command.title ? { title: command.title } : {}),
          })
          .pipe(map((finding) => ({ kind: 'finding', finding })));
      case 'createProposal':
        return this.http
          .post<InitiativeProposalDto>(`${api}/initiatives/${command.initiativeId}/proposals`, command.dto)
          .pipe(map((proposal) => ({ kind: 'proposal', proposal })));
      case 'acceptProposal':
        return this.http
          .post<InitiativeProposalDto>(`${api}/initiative-proposals/${command.proposalId}/accept`, {
            ...(command.note ? { note: command.note } : {}),
            ...(command.closeDroppedTickets ? { closeDroppedTickets: true } : {}),
          })
          .pipe(map((proposal) => ({ kind: 'proposal', proposal })));
      case 'rejectProposal':
        return this.http
          .post<InitiativeProposalDto>(
            `${api}/initiative-proposals/${command.proposalId}/reject`,
            command.note ? { note: command.note } : {},
          )
          .pipe(map((proposal) => ({ kind: 'proposal', proposal })));
      case 'createDecision':
        return this.http
          .post<InitiativeDecisionDto>(`${api}/initiatives/${command.initiativeId}/decisions`, command.dto)
          .pipe(map((decision) => ({ kind: 'decision', decision })));
      case 'decideDecision':
        return this.http
          .post<InitiativeDecisionDto>(`${api}/initiative-decisions/${command.decisionId}/decide`, {
            status: command.status,
          })
          .pipe(map((decision) => ({ kind: 'decision', decision })));
    }
  }

  private workItemsResult(request: Observable<InitiativeWorkItemsDto>): Observable<InitiativeCommandResult> {
    return request.pipe(
      map((workItems) => ({ kind: 'workItems' as const, initiativeId: workItems.initiativeId, workItems })),
    );
  }
}
