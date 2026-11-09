import type { InitiativeArtifactType } from './catalog';

/**
 * Document skeletons. Their structure follows the BMad Method document guidance (MIT, see NOTICE.md); the agent fills
 * them in step sessions and users edit them on the Initiatives page.
 */
export const INITIATIVE_ARTIFACT_TEMPLATES: Record<InitiativeArtifactType, string> = {
  brainstorm: `# Brainstorm: <topic>

## Framing
<!-- The question being explored and its constraints. -->

## Ideas by theme
### <theme>
- …

## Shortlist
| Idea | Why it is promising | Open questions |
| ---- | ------------------- | -------------- |

## Next steps
`,
  'forge-report': `# Forge report: <idea>

## Verdict
<!-- hardened / needs evidence / dropped -->

## Hardened intent
- **True when done:** …
- **Must not change:** …
- **Out of scope:** …

## Who has the problem and how they solve it today

## What must be true
| Assumption | Evidence | Risk |
| ---------- | -------- | ---- |

## Smallest version worth building
`,
  research: `# Research: <decision>

## Decision to support

## Findings
<!-- Every claim cites its source (file path, URL or ref). -->

## Options
| Option | Pros | Cons |
| ------ | ---- | ---- |

## Recommendation and confidence
`,
  'product-brief': `# Product brief: <product>

## Problem
## Target users
## Proposed solution
## Why now
## Success metrics
## Scope
- **In:** …
- **Out:** …
`,
  prfaq: `# PRFAQ: <product>

## Press release
**Headline:** …

<!-- Problem, solution, customer quote, how to get started. -->

## Customer FAQ

## Internal FAQ
`,
  prd: `# PRD: <product>

## Goals and background
## Users and journeys
<!-- Journeys use a named protagonist. -->

## Functional requirements
### <feature group>
- **FR-1** …

## Non-functional requirements
- **NFR-1** …

## Out of scope
## Open questions
`,
  ux: `# UX design: <product>

## Principles
## Information architecture
## Key screens and states
### <screen>
- Serves: FR-…
- States: empty, loading, error, …

## Interaction patterns
## Accessibility
`,
  architecture: `# Architecture: <product>

## Context and constraints
## Components and responsibilities
## Data model
## Interfaces and contracts
## Cross-cutting concerns
<!-- Security, errors, observability, performance. -->

## Decisions
### <decision>
- **Options:** …
- **Choice and reason:** …
- **Requirements:** FR-…
`,
  'project-context': `<!-- Agent instructions that cannot be learned from the code. Verify every path. -->

## Policies
## Frozen or generated paths
## Commands and caveats
## Conventions that differ from defaults
## Observed pitfalls
## Pointers
`,
  retrospective: `# Retrospective: <epic>

## Verdict
<!-- accepted / accepted-with-open-items / rejected -->

## Evidence inventory
## Findings
### <group>
- … (evidence: …)

## Action items
## Spec reconciliations
`,
  note: `# <title>
`,
};
