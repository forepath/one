import { isUsablePartialPrototype } from './automation-usable-partial';

describe('isUsablePartialPrototype (Stricter A)', () => {
  it('returns false when branch is missing', () => {
    expect(
      isUsablePartialPrototype({
        branchName: null,
        hasNonZeroDiffAgainstMergeBase: true,
        iterationCount: 2,
        hasAgentStepWithNonEmptyExcerpt: true,
      }),
    ).toBe(false);
  });

  it('returns false when no diff against merge base', () => {
    expect(
      isUsablePartialPrototype({
        branchName: 'automation/abc',
        hasNonZeroDiffAgainstMergeBase: false,
        iterationCount: 2,
        hasAgentStepWithNonEmptyExcerpt: true,
      }),
    ).toBe(false);
  });

  it('returns false when iteration count is zero', () => {
    expect(
      isUsablePartialPrototype({
        branchName: 'automation/abc',
        hasNonZeroDiffAgainstMergeBase: true,
        iterationCount: 0,
        hasAgentStepWithNonEmptyExcerpt: true,
      }),
    ).toBe(false);
  });

  it('returns true when all stricter conditions hold', () => {
    expect(
      isUsablePartialPrototype({
        branchName: 'automation/abc',
        hasNonZeroDiffAgainstMergeBase: true,
        iterationCount: 1,
        hasAgentStepWithNonEmptyExcerpt: true,
      }),
    ).toBe(true);
  });

  it('returns false when branch and diff exist but no agent excerpt was persisted', () => {
    expect(
      isUsablePartialPrototype({
        branchName: 'automation/abc',
        hasNonZeroDiffAgainstMergeBase: true,
        iterationCount: 2,
        hasAgentStepWithNonEmptyExcerpt: false,
      }),
    ).toBe(false);
  });

  it('returns false when branchName is only whitespace', () => {
    expect(
      isUsablePartialPrototype({
        branchName: '   ',
        hasNonZeroDiffAgainstMergeBase: true,
        iterationCount: 1,
        hasAgentStepWithNonEmptyExcerpt: true,
      }),
    ).toBe(false);
  });
});
