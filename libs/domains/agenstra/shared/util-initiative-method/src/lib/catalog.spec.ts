import {
  INITIATIVE_ARTIFACT_TYPES,
  INITIATIVE_STEP_KEYS,
  INITIATIVE_STEPS,
  findInitiativeStep,
  isInitiativeStepKey,
} from './catalog';
import { buildInitiativeFollowUpPrompt, buildInitiativeStepPrompt } from './prompt';
import { INITIATIVE_ARTIFACT_TEMPLATES } from './templates';

describe('step catalog', () => {
  it('defines every step key exactly once', () => {
    expect(INITIATIVE_STEPS.map((step) => step.key).sort()).toEqual([...INITIATIVE_STEP_KEYS].sort());
  });

  it('has a template for every artifact type', () => {
    for (const type of INITIATIVE_ARTIFACT_TYPES) {
      expect(INITIATIVE_ARTIFACT_TEMPLATES[type].trim().length).toBeGreaterThan(0);
    }
  });

  it('targets epics only for epic steps', () => {
    for (const step of INITIATIVE_STEPS) {
      const needsEpic = step.hardNeeds.some((need) =>
        ['target-epic', 'refined-epic', 'epic-with-stories'].includes(need.kind),
      );

      expect(step.target === 'epic').toBe(needsEpic);
    }
  });

  it('looks steps up safely', () => {
    expect(findInitiativeStep('prd')?.role).toBe('product_manager');
    expect(findInitiativeStep('__proto__')).toBeUndefined();
    expect(isInitiativeStepKey('retrospective')).toBe(true);
    expect(isInitiativeStepKey('build')).toBe(false);
  });
});

describe('prompts', () => {
  const base = {
    mode: 'create' as const,
    style: 'coaching' as const,
    initiative: { title: 'Checkout "v2"', path: 'project', iteration: 2, ref: 'initiative:abcd1234' },
    contextRefs: ['initiative:abcd1234', 'artifact:ffff0000'],
  };

  it('builds a read-only prompt with the output contract of the step', () => {
    const prompt = buildInitiativeStepPrompt({
      ...base,
      step: findInitiativeStep('prd')!,
      userMessage: 'Focus on B2B',
    });

    expect(prompt).toContain('You are the Product Manager');
    expect(prompt).toContain('read-only');
    expect(prompt).toContain('"Checkout \\"v2\\""');
    expect(prompt).toContain('draftMarkdown');
    expect(prompt).toContain('<user-request>\nFocus on B2B\n</user-request>');
    expect(prompt).toContain('Read first: initiative:abcd1234, artifact:ffff0000');
  });

  it('switches validate runs to findings', () => {
    const prompt = buildInitiativeStepPrompt({ ...base, mode: 'validate', step: findInitiativeStep('architecture')! });

    expect(prompt).toContain('Validate the current document without changing it');
    expect(prompt).not.toContain('Start from this structure');
  });

  it('describes work items for slicing steps', () => {
    expect(
      buildInitiativeStepPrompt({
        ...base,
        step: findInitiativeStep('incept-stories')!,
        target: { label: 'E1 Login' },
      }),
    ).toContain('"verify"');
    expect(
      buildInitiativeStepPrompt({ ...base, style: 'fast', step: findInitiativeStep('correct-course')! }),
    ).toContain('[ASSUMPTION]');
  });

  it('wraps follow-up answers as data', () => {
    expect(buildInitiativeFollowUpPrompt(' yes ')).toContain('<user-message>\nyes\n</user-message>');
  });
});
