# Initiatives

Initiatives are the workspace's planning context. They follow the [BMad Method](https://docs.bmad-method.org/)
delivery loop — **Clarify → Plan → Build & verify → Learn & adjust** — and hand the planned work to the build tools
Agenstra already has (tickets, chat plans, ticket automation). Every workspace has its own initiatives, like tickets and
knowledge pages.

> Initiatives are an independent implementation that follows (and is compatible with) the BMad Method. They are not an
> official BMad product. The step catalog and document structures are modelled on BMAD-METHOD (MIT); see
> `libs/domains/agenstra/shared/util-initiative-method/NOTICE.md`.

## Overview

| Concept          | What it is                                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Initiative**   | A body of work with an intent, a planning **path** (one session, epic, project), a **phase** of the loop, a **state** and an **iteration** counter.           |
| **Documents**    | Brainstorm, forge report, research, product brief, PRFAQ, PRD, UX, architecture, project context, retrospectives (per epic) and notes. Every version is kept. |
| **Work items**   | Epics → stories, spikes and bugs in **build order**, with stable keys (`E1`, `E1.S2`), `after` dependencies, open questions, verify / done-when checks.       |
| **Guided steps** | A role of the method (Analyst, Product Manager, UX Designer, Architect, Product Owner, Developer) works through a step with the user in a read-only session.  |
| **Proposals**    | Change proposals (correct course): new document versions, work-item operations and decisions, applied atomically when a person accepts them.                  |
| **Findings**     | Results of retrospectives, reviews, automation runs, agents and people. Inert until converted (proposal or work item) or dismissed.                           |
| **Decisions**    | Dated decision lines / ADRs. Agents only propose them; people accept.                                                                                         |

The console page is **Initiatives** (`/initiatives/:clientId?initiativeId=&tab=`, sidebar above **Tickets**) with the
same workspace picker as tickets, knowledge, plans and tasks.

Page layout (like the ticket, page and plan details):

- **List** of initiatives on the left; the open initiative shows its header (state, path, iteration, settings) and the
  phase strip (Clarify → Plan → Build & verify → Learn & adjust).
- **Tabs** in the content column: **Guided steps** (default), **Work items**, **Documents**, **Learn & adjust**,
  **Activity**. Every list is a searchable table with a State column and the actions in the row menu (⋮); details and
  forms open in modals (document with editor and versions, work item, start a guided step, proposal review, finding,
  decision). A guided step's conversation opens in place of the table.
- **Sidebar** on the right, in every tab: intent, **What's next**, progress and the work items outline, so the plan
  stays in view while working through a step. Choosing a work item there opens it in the Work items tab.

## The loop

| Phase          | Steps (role)                                                                              | Output                                       |
| -------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------- |
| Clarify        | Brainstorm, Forge the idea, Research a decision (Analyst)                                 | Brainstorm, forge report, research documents |
| Plan · define  | Product brief, PRFAQ, PRD (Product Manager); create, update or validate                   | Documents (PRD with stable FR / NFR IDs)     |
| Plan · design  | UX (UX Designer), Architecture (Architect)                                                | Documents                                    |
| Plan · slice   | Slice into epics, Refine epic, Incept stories, Readiness review (Product Owner)           | Epics, epic requirements, stories, findings  |
| Build & verify | Transfer to tickets, release ready stories, plan a story (chat plan), ticket automation   | Tickets, plans, prototypes                   |
| Learn & adjust | Epic retrospective (Developer), Correct course (Product Owner), Project context (Analyst) | Verdict, findings, proposals, next iteration |

**What's next** in the sidebar follows the method's ordering: intent → the shared contracts the path calls for → slice
into epics → per epic refine → incept → transfer → build → retrospective. Open proposals and findings come first. Steps
have hard needs (e.g. stories need a refined epic) and soft recommendations (e.g. a PRD before slicing a project).

## Guided steps (step runs)

- A step runs in a **hidden, read-only** OpenCode session `-initiative-{runId}` of a chosen environment (the
  initiative's facilitator environment by default): the same explore-only agent and permission ruleset as chat plan
  explore sessions (read / glob / grep / list / web search; no edits, writes or shell).
- The session gets the initiative overview, the accepted shared contracts and the target document as **pre-granted
  context** (context MCP refs `initiative:<sha>` / `artifact:<sha>`); nothing else can be granted automatically.
- Every answer ends with a structured status block (`needs_input`, `drafting`, `ready`) carrying the result: a document
  draft, work items, an epic refinement, findings, a verdict, decisions or a change proposal. The result is shown live.
- **Coaching** works through the topic section by section; the **fast path** drafts at once and marks guesses.
- Any member of the workspace can answer; one turn at a time (a message while the agent works is refused).
- **Accept result** applies it as the signed-off outcome of a person: documents become accepted versions, work items are
  created (keys allocated), findings and decisions recorded, the retrospective verdict set. If the target document
  changed while the run worked, accepting creates a **change proposal** instead of overwriting.
- Limits: one active run per step and target, at most `INITIATIVE_MAX_ACTIVE_RUNS_PER_CLIENT` (default 3) active runs per
  workspace.

## Documents

- Edited with the same markdown editor as knowledge pages; saving creates a new version and is conditional on the version
  the user started from (409 "changed meanwhile" → load the latest version). Unsaved edits are never overwritten by live
  updates.
- **Accept version** makes the current version the accepted contract (people only). Step sessions read accepted versions.
- **Versions** lists every version (iteration, source: person, run or proposal); any version can be viewed.
- **Publish to Knowledge** copies the current version into a knowledge page (snapshot; needs `knowledge:write`).
- Reference: `artifact:<sha>` (copy button) for chats and agents.

## Work items and the build

- Epics and items have stable keys that are never reused. Items that are **built or done are never rewritten**; changes
  add new items instead.
- **Dependencies** (`after`) name earlier items or whole epics; dependencies of an epic apply to its items. Cycles are
  refused. An epic counts as satisfied when all its items are and its latest retrospective did not reject it.
- **Prerequisites are satisfied** when they are `done` (default) or `built` (initiative setting). A **done checkpoint**
  makes dependents wait for `done` either way.
- **Transfer to tickets** creates a ticket per epic and a subtask per story / spike / bug (as `draft`), through the ticket
  service with the user's access (activity, realtime, webhooks unchanged). The ticket body carries the requirements,
  checks and the `initiative:<sha>` reference. Optionally ticket automation is configured for the stories (workspace
  managers, model required); a **plan checkpoint** turns on automation approval. Transfers are idempotent.
- **Release** moves ready stories (all prerequisites satisfied) from `draft` to `todo`. With **auto release** the
  initiative does it automatically (system activity) whenever prerequisites become satisfied.
- **Ticket automation respects dependencies**: a ticket whose initiative story waits for prerequisites (or was dropped) is
  never picked, even if someone moves it to `todo` by hand. Tickets that are not linked to an initiative behave exactly as
  before. See [Ticket automation](./ticket-automation.md#initiatives).
- Linked tickets are the source of truth for the build status: `draft` → draft, `todo` → ready for dev, `in_progress` →
  in progress, `prototype` → built, `done` → done, `closed` → dropped. **Mark done** on the page sets the ticket to `done`
  (BMad: only people mark done). A ticket moved to another workspace is unlinked.
- The **ticket board** shows the story key on a linked ticket (and what it waits for), linking back to the initiative.
- **Plan** (story) creates a chat plan on a chosen environment and chat with the story ticket and the initiative documents
  as pre-granted context. See [Chat plan mode](./chat-plan-mode.md#plans-from-initiative-stories).

## Learn & adjust

- **Epic retrospective**: judges a finished epic from evidence (requirements, linked tickets, automation results,
  repository). Unfinished stories force `rejected`; a person can override the verdict. A rejected epic blocks its
  dependents. Decisions it proposes stay `proposed` until a person accepts each one.
- **Findings** can be converted into a new work item (below an epic) or selected as the start of a **Correct course**
  step, which drafts a change proposal.
- **Change proposals** (from people, runs, chats, tasks) show their document versions, work-item operations and
  decisions. **Accept and apply** applies everything atomically: document versions (accepted), adds / updates / moves /
  drops of items that have not started, accepted decisions, and — by default — the **next iteration**. Tickets of changed
  stories that have not started get the regenerated body; started ones get a comment. Dropping a transferred story closes
  its ticket only after explicit confirmation. A proposal whose documents moved on becomes **stale**.

## Agents (context MCP)

Agents read initiatives with the existing context tools (`initiative:<sha>` overview incl. work items and documents,
`artifact:<sha>` document) and write through two content tools:

| Tool                                  | Effect                                                                        |
| ------------------------------------- | ----------------------------------------------------------------------------- |
| `agenstra_content_initiative_propose` | Change proposal (never applied by the agent; a person accepts it on the page) |
| `agenstra_content_initiative_finding` | Finding on the initiative or one work item (`itemKey`), with evidence         |

| Session                             | Reads                                                                   | Writes                                                                                    |
| ----------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Step run (`-initiative-*`)          | Pre-granted initiative context only                                     | None (the result is the status block a person accepts)                                    |
| Visible chat                        | As today (search; access requests the user approves)                    | Per-change prompt (_Allow once_ / _for this chat_ / _Deny_)                               |
| Ticket automation of a linked story | Pre-granted: the story's initiative overview and accepted documents     | `initiative.finding` on its own story only, when allowed for the automation (opt-in)      |
| Scheduled task                      | Pre-granted context only                                                | Only operations a person allowed for the task (`initiative.propose` / `.finding` opt-ins) |
| Chat plan explore / refine          | Pre-granted context (plans created from a story include its initiative) | Never                                                                                     |

See [Agent Context MCP](../ai-agents/context-mcp.md).

## Live collaboration

The page is live for everybody in the workspace (Socket.IO namespace `socket/initiatives`, room `client:{clientId}`,
listen-only; every command is REST):

`initiativeUpsert`, `initiativeRemoved`, `initiativeArtifactUpsert` (metadata and version; content is fetched over REST),
`initiativeArtifactRemoved`, `initiativeWorkItemsChanged` (tree with effective statuses, incl. changes of linked
tickets), `initiativeRunUpsert` (status, live text), `initiativeRunTurnAppended`, `initiativeProposalUpsert`,
`initiativeFindingUpsert`, `initiativeDecisionUpsert`, `initiativeActivityCreated`.

Every write is conditional on the version the user saw (initiative, document, work item, run): concurrent changes are
refused with 409 and the page offers **Load latest version**. Accept / reject / transfer / release are exactly-once
transitions.

## Security

- Workspace access like tickets and knowledge (global admin, workspace creator, members); environments of runs and plans
  must belong to the workspace. Agents only reach their own workspace.
- Machine tokens: `initiatives:read` / `initiatives:write`, `websocket:initiatives:read`, plus the domain scope of every
  side effect: transfer / release / proposal accept / mark done also need `tickets:write`, publishing `knowledge:write`,
  runs and story plans `agent_chats:write`.
- Accepting results, documents, proposals and decisions is for people only (agents get "not found").
- Step sessions cannot edit files, run commands or hand off; their output is inert until a person accepts it. Agent
  input never selects a session's permissions (the manager derives them from the session suffix).
- Webhook payloads carry ids, titles, statuses and versions only — never document content.

## HTTP

| Method               | Path                                                                                                                             | Scope                                         |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------ |
| GET / POST           | `/initiatives?clientId=&search=&state=`, `/initiatives`                                                                          | read / write                                  |
| GET / PATCH / DELETE | `/initiatives/{id}` (PATCH with `expectedVersion`)                                                                               | read / write                                  |
| POST                 | `/initiatives/{id}/iterations`                                                                                                   | write                                         |
| GET                  | `/initiatives/{id}/overview`, `/initiatives/{id}/activity`                                                                       | read                                          |
| GET / POST           | `/initiatives/{id}/artifacts`; GET / PATCH / DELETE `/initiative-artifacts/{id}`; POST `.../accept`; GET `.../versions[/{v}]`    | read / write                                  |
| POST                 | `/initiative-artifacts/{id}/publish`                                                                                             | write + `knowledge:write`                     |
| GET / POST           | `/initiatives/{id}/work-items`; PATCH / DELETE `/initiative-work-items/{id}`; POST `.../reorder`; PUT `.../dependencies`         | read / write                                  |
| POST                 | `/initiative-work-items/{id}/status`                                                                                             | write + `tickets:write`                       |
| POST                 | `/initiative-work-items/{id}/plan`                                                                                               | write + `agent_chats:write` + `tickets:read`  |
| POST                 | `/initiative-work-items/{id}/retrospective-verdict`                                                                              | write                                         |
| POST / DELETE        | `/initiatives/{id}/unknowns`, `/initiative-unknowns/{id}/resolve`, `/initiative-unknowns/{id}`                                   | write                                         |
| POST                 | `/initiatives/{id}/transfer`, `/initiatives/{id}/release`                                                                        | write + `tickets:write`                       |
| GET / POST           | `/initiatives/{id}/runs`, `/initiative-runs/{id}`, POST `.../messages`, `.../retry`                                              | read / write + `agent_chats:write`            |
| POST                 | `/initiative-runs/{id}/accept`, `.../discard`, `.../cancel`                                                                      | write                                         |
| GET                  | `/tickets/{ticketId}/initiative-link` (ticket board chip: story key, prerequisites, automation gate)                             | `tickets:read` + `initiatives:read`           |
| GET / POST / PATCH   | findings, proposals, decisions (`/initiatives/{id}/…`, `/initiative-findings/{id}[/convert]`, `/initiative-proposals/{id}/accept | reject`, `/initiative-decisions/{id}/decide`) | read / write (proposal accept + `tickets:write`) |

See the [Agent Controller OpenAPI](/spec/agent-controller/openapi.yaml).

## Webhooks

`initiative.created`, `initiative.updated`, `initiative.deleted`, `initiative.artifact.accepted`,
`initiative.run.needs_input`, `initiative.run.ready`, `initiative.run.failed`, `initiative.proposal.created`,
`initiative.proposal.decided`, `initiative.work_items.transferred`, `initiative.work_items.released`,
`initiative.retrospective.completed`. See [Webhooks](./webhooks.md).

## Related documentation

- [Tickets and Workspaces](./tickets-and-workspaces.md)
- [Ticket automation](./ticket-automation.md)
- [Chat plan mode](./chat-plan-mode.md)
- [Agent tasks](./agent-tasks.md)
- [Agent Context MCP](../ai-agents/context-mcp.md)
- [Authentication](./authentication.md)
