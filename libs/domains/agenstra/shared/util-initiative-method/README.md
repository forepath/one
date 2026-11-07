# agenstra-shared-util-initiative-method

Shared rules of Agenstra **Initiatives** (workspace planning that follows the BMad Method, see `NOTICE.md`):

- `catalog.ts`: phases, paths, roles, artifact types, work-item kinds and statuses, the step catalog and input limits.
- `rules.ts`: work-item status from the linked ticket, readiness and dependency gating, cycle detection, stable keys,
  step availability and "What's next".
- `turn-status.ts`: parsing and bounding of the status block an agent returns at the end of a step-session turn.
- `templates.ts`: document skeletons.
- `prompt.ts`: the fixed platform prompts of step sessions.

Used by the agent controller, the agent console and the specs of both. No runtime dependencies.

## Targets

```bash
npx nx test agenstra-shared-util-initiative-method
```
