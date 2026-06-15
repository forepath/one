# agenstra-frontend-data-access-agent-console

This library was generated with [Nx](https://nx.dev).

## Autonomous ticket prototyping (NgRx)

State for **ticket automation** (per-ticket config, runs, approve, cancel) lives under the `ticketAutomation` feature key. Use `TicketAutomationFacade` to load/patch configuration, list runs, open run detail (with steps), and cancel active runs. HTTP calls go through `TicketsService` (`/tickets/:ticketId/automation/...`).

**Client agent autonomy** (per client + agent limits and allowlists) uses the `clientAgentAutonomy` feature key and `ClientAgentAutonomyFacade`, backed by `ClientsService` (`PUT/GET /clients/:id/agents/:agentId/autonomy`).

Facades, reducers, effects, and selectors are registered in `feature-agent-console` route providers (`agent-console.routes.ts`) alongside existing agent-console state.

See `docs/ticket-automation-state.mmd` for a high-level diagram.

## Running unit tests

Run `nx test agenstra-frontend-data-access-agent-console` to execute the unit tests.
