/**
 * Seeds for spec-driven-style subtasks when creating a root ticket with `creationTemplate: specification`.
 * Wording follows OpenSpec spec-driven artifacts (proposal → specs → design → tasks), adapted for agent-console tickets.
 */

export interface SpecificationSubtaskSeed {
  title: string;
  content: string;
}

const PARENT_CONTENT_MAX = 800;

function excerptParentContext(content: string | null | undefined): string {
  if (!content?.trim()) {
    return '_No description on the parent ticket yet—fill the parent body or paste context here._';
  }

  const t = content.trim();

  return t.length <= PARENT_CONTENT_MAX ? t : `${t.slice(0, PARENT_CONTENT_MAX)}…`;
}

export function buildSpecificationSubtaskSeeds(
  parentTitle: string,
  parentContent: string | null | undefined,
): SpecificationSubtaskSeed[] {
  const ctx = excerptParentContext(parentContent);

  return [
    {
      title: 'Proposal',
      content: `This subtask captures the **proposal** for the parent initiative **${parentTitle}**.

## Parent context

${ctx}

## Why

- What problem or opportunity does this address?
- Why now?

## What changes

- Bullet list of concrete changes (features, fixes, removals).
- Mark **BREAKING** where relevant.

## Capabilities

### New capabilities
- List new behaviors or areas; use short kebab-style names where helpful.

### Modified capabilities
- List existing behaviors whose *requirements* change (not implementation-only tweaks).

## Impact

- Affected code, APIs, agents, workspaces, or dependencies.

---
_Fill this in, then move on to **Specifications**._`,
    },
    {
      title: 'Specifications',
      content: `Normative requirements for **${parentTitle}**. Align with the **Proposal** subtask.

Use \`### Requirement: <name>\` and **SHALL/MUST** language. Every requirement needs at least one scenario with exactly \`#### Scenario: <name>\` and **WHEN** / **THEN** bullets.

## ADDED Requirements

### Requirement: <!-- name -->
The system SHALL …

#### Scenario: <!-- name -->
- **WHEN** …
- **THEN** …

## MODIFIED Requirements

_Copy the full requirement block from the prior spec, then edit. Header text must match exactly (whitespace-insensitive)._

### Requirement: <!-- name -->
…

#### Scenario: <!-- name -->
- **WHEN** …
- **THEN** …

## REMOVED Requirements

### Requirement: <!-- name -->
**Reason**: …
**Migration**: …

## RENAMED Requirements

- **FROM:** … **TO:** …

---
_Keep scenarios testable—each scenario is a potential test case._`,
    },
    {
      title: 'Technical design',
      content: `Technical design for **${parentTitle}**. Implements what **Specifications** define.

## Context

- Current state, constraints, stakeholders.

## Goals / Non-Goals

**Goals:**
- …

**Non-Goals:**
- …

## Decisions

- Key choices with rationale; note alternatives considered.

## Risks / Trade-offs

- [Risk] → Mitigation

## Migration / rollout

- Deploy steps, feature flags, rollback.

## Open questions

- …

---
_Reference the **Proposal** for motivation and **Specifications** for requirements._`,
    },
    {
      title: 'Implementation plan',
      content: `Trackable implementation work for **${parentTitle}**. Derive tasks from **Technical design** and **Specifications**.

Use checkbox lines so progress can be scanned.

## 1. <!-- Group name -->

- [ ] 1.1 <!-- Task -->
- [ ] 1.2 <!-- Task -->

## 2. <!-- Group name -->

- [ ] 2.1 <!-- Task -->
- [ ] 2.2 <!-- Task -->

---
_Order by dependency. Keep tasks small enough for one session._`,
    },
  ];
}
