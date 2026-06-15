import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import {
  clearSelectedClientAgent,
  createClientAgent,
  deleteClientAgent,
  loadClientAgent,
  loadClientAgentModels,
  loadClientAgents,
  restartClientAgent,
  startClientAgent,
  stopClientAgent,
  updateClientAgent,
} from './agents.actions';
import {
  selectClientAgentById,
  selectClientAgentCommands,
  selectClientAgentLoading,
  selectClientAgentLoadingCommands,
  selectClientAgentModels,
  selectClientAgentModelsError,
  selectClientAgentModelsLoading,
  selectClientAgents,
  selectClientAgentsCount,
  selectClientAgentsCreating,
  selectClientAgentsDeleting,
  selectClientAgentsError,
  selectClientAgentsLoading,
  selectClientAgentsLoadingAny,
  selectClientAgentsRestarting,
  selectClientAgentsStarting,
  selectClientAgentsStopping,
  selectClientAgentsUpdating,
  selectHasClientAgents,
  selectSelectedClientAgent,
} from './agents.selectors';
import type {
  AgentModelsMap,
  AgentResponseDto,
  CreateAgentDto,
  ListClientAgentsParams,
  UpdateAgentDto,
} from './agents.types';

/**
 * Facade for agents state management.
 * Provides a clean API for components to interact with agents state
 * without directly accessing the NgRx store.
 * All operations are scoped to a specific client.
 */
@Injectable({
  providedIn: 'root',
})
export class AgentsFacade {
  private readonly store = inject(Store);

  /**
   * Get agents for a specific client.
   * @param clientId - The client ID
   * @returns Observable of agents array
   */
  getClientAgents$(clientId: string): Observable<AgentResponseDto[]> {
    return this.store.select(selectClientAgents(clientId));
  }

  /**
   * Get the selected agent for a specific client.
   * @param clientId - The client ID
   * @returns Observable of the selected agent or null
   */
  getSelectedClientAgent$(clientId: string): Observable<AgentResponseDto | null> {
    return this.store.select(selectSelectedClientAgent(clientId));
  }

  /**
   * Get loading state for a client's agents list.
   * @param clientId - The client ID
   * @returns Observable of loading state
   */
  getClientAgentsLoading$(clientId: string): Observable<boolean> {
    return this.store.select(selectClientAgentsLoading(clientId));
  }

  /**
   * Get loading state for a single agent operation.
   * @param clientId - The client ID
   * @returns Observable of loading state
   */
  getClientAgentLoading$(clientId: string): Observable<boolean> {
    return this.store.select(selectClientAgentLoading(clientId));
  }

  /**
   * Get creating state for a client.
   * @param clientId - The client ID
   * @returns Observable of creating state
   */
  getClientAgentsCreating$(clientId: string): Observable<boolean> {
    return this.store.select(selectClientAgentsCreating(clientId));
  }

  /**
   * Get updating state for a client.
   * @param clientId - The client ID
   * @returns Observable of updating state
   */
  getClientAgentsUpdating$(clientId: string): Observable<boolean> {
    return this.store.select(selectClientAgentsUpdating(clientId));
  }

  /**
   * Get deleting state for a client.
   * @param clientId - The client ID
   * @returns Observable of deleting state
   */
  getClientAgentsDeleting$(clientId: string): Observable<boolean> {
    return this.store.select(selectClientAgentsDeleting(clientId));
  }

  /**
   * Get starting state for a client.
   * @param clientId - The client ID
   * @returns Observable of starting state
   */
  getClientAgentsStarting$(clientId: string): Observable<boolean> {
    return this.store.select(selectClientAgentsStarting(clientId));
  }

  /**
   * Get stopping state for a client.
   * @param clientId - The client ID
   * @returns Observable of stopping state
   */
  getClientAgentsStopping$(clientId: string): Observable<boolean> {
    return this.store.select(selectClientAgentsStopping(clientId));
  }

  /**
   * Get restarting state for a client.
   * @param clientId - The client ID
   * @returns Observable of restarting state
   */
  getClientAgentsRestarting$(clientId: string): Observable<boolean> {
    return this.store.select(selectClientAgentsRestarting(clientId));
  }

  /**
   * Get combined loading state for a client (true if any operation is loading).
   * @param clientId - The client ID
   * @returns Observable of combined loading state
   */
  getClientAgentsLoadingAny$(clientId: string): Observable<boolean> {
    return this.store.select(selectClientAgentsLoadingAny(clientId));
  }

  /**
   * Get error state for a client.
   * @param clientId - The client ID
   * @returns Observable of error message or null
   */
  getClientAgentsError$(clientId: string): Observable<string | null> {
    return this.store.select(selectClientAgentsError(clientId));
  }

  /**
   * Get count of agents for a client.
   * @param clientId - The client ID
   * @returns Observable of agent count
   */
  getClientAgentsCount$(clientId: string): Observable<number> {
    return this.store.select(selectClientAgentsCount(clientId));
  }

  /**
   * Check if a client has agents.
   * @param clientId - The client ID
   * @returns Observable of boolean
   */
  hasClientAgents$(clientId: string): Observable<boolean> {
    return this.store.select(selectHasClientAgents(clientId));
  }

  /**
   * Get a specific agent by ID for a client.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   * @returns Observable of the agent or null if not found
   */
  getClientAgentById$(clientId: string, agentId: string): Observable<AgentResponseDto | null> {
    return this.store.select(selectClientAgentById(clientId, agentId));
  }

  /**
   * Load all agents for a specific client with optional pagination.
   * @param clientId - The client ID
   * @param params - Optional pagination parameters
   */
  loadClientAgents(clientId: string, params?: ListClientAgentsParams): void {
    this.store.dispatch(loadClientAgents({ clientId, params }));
  }

  /**
   * Load a specific agent by ID for a client.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   */
  loadClientAgent(clientId: string, agentId: string): void {
    this.store.dispatch(loadClientAgent({ clientId, agentId }));
  }

  /**
   * Load the provider model list for a client agent (dispatches to effects → HTTP).
   */
  loadClientAgentModels(clientId: string, agentId: string): void {
    this.store.dispatch(loadClientAgentModels({ clientId, agentId }));
  }

  /**
   * Cached model id → label map for an agent, or null if not loaded.
   */
  getClientAgentModels$(clientId: string, agentId: string): Observable<AgentModelsMap | null> {
    return this.store.select(selectClientAgentModels(clientId, agentId));
  }

  getClientAgentModelsLoading$(clientId: string, agentId: string): Observable<boolean> {
    return this.store.select(selectClientAgentModelsLoading(clientId, agentId));
  }

  getClientAgentModelsError$(clientId: string, agentId: string): Observable<string | null> {
    return this.store.select(selectClientAgentModelsError(clientId, agentId));
  }

  /**
   * Create a new agent for a client.
   * @param clientId - The client ID
   * @param agent - The agent data to create
   */
  createClientAgent(clientId: string, agent: CreateAgentDto): void {
    this.store.dispatch(createClientAgent({ clientId, agent }));
  }

  /**
   * Update an existing agent for a client.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   * @param agent - The agent data to update
   */
  updateClientAgent(clientId: string, agentId: string, agent: UpdateAgentDto): void {
    this.store.dispatch(updateClientAgent({ clientId, agentId, agent }));
  }

  /**
   * Delete an agent for a client.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   */
  deleteClientAgent(clientId: string, agentId: string): void {
    this.store.dispatch(deleteClientAgent({ clientId, agentId }));
  }

  /**
   * Start all containers for an agent for a client.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   */
  startClientAgent(clientId: string, agentId: string): void {
    this.store.dispatch(startClientAgent({ clientId, agentId }));
  }

  /**
   * Stop all containers for an agent for a client.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   */
  stopClientAgent(clientId: string, agentId: string): void {
    this.store.dispatch(stopClientAgent({ clientId, agentId }));
  }

  /**
   * Restart all containers for an agent for a client.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   */
  restartClientAgent(clientId: string, agentId: string): void {
    this.store.dispatch(restartClientAgent({ clientId, agentId }));
  }

  /**
   * Clear the selected agent for a client.
   * @param clientId - The client ID
   */
  clearSelectedClientAgent(clientId: string): void {
    this.store.dispatch(clearSelectedClientAgent({ clientId }));
  }

  /**
   * Get commands for a specific client and agent.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   * @param agentType - The agent type (e.g., 'cursor', 'opencode', 'openclaw')
   * @returns Observable of commands array
   */
  getClientAgentCommands$(clientId: string, agentId: string, agentType: string): Observable<string[]> {
    return this.store.select(selectClientAgentCommands(clientId, agentId, agentType));
  }

  /**
   * Get loading state for commands for a specific client and agent.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   * @returns Observable of loading state
   */
  getClientAgentLoadingCommands$(clientId: string, agentId: string): Observable<boolean> {
    return this.store.select(selectClientAgentLoadingCommands(clientId, agentId));
  }
}
