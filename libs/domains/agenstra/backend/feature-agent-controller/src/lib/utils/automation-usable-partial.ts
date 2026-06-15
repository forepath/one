/**
 * **Chosen rule (Stricter A):** a run counts as having a usable partial prototype only when all hold:
 * - `branchName` is set
 * - VCS reports a non-zero change vs merge-base between `baseBranch` and branch tip
 * - `iterationCount >= 1`
 * - At least one persisted agent-loop step has a non-empty `excerpt`
 *
 * **Looser B** (branch-only) is intentionally not used so failed runs do not flood `in_progress`
 * when the branch exists but no work was produced.
 */
export interface UsablePartialPrototypeInput {
  branchName: string | null | undefined;
  hasNonZeroDiffAgainstMergeBase: boolean;
  iterationCount: number;
  hasAgentStepWithNonEmptyExcerpt: boolean;
}

export function isUsablePartialPrototype(input: UsablePartialPrototypeInput): boolean {
  if (!input.branchName?.trim()) {
    return false;
  }

  if (!input.hasNonZeroDiffAgainstMergeBase) {
    return false;
  }

  if (input.iterationCount < 1) {
    return false;
  }

  return input.hasAgentStepWithNonEmptyExcerpt;
}
