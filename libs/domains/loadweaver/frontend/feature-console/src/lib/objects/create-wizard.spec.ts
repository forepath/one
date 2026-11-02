import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { Draft } from '@forepath/loadweaver/frontend/data-access-console';

import { draftChipCount, LoadweaverDraftTrayComponent, previewRisks } from '../nav/draft-tray.component';
import { WorkspaceDraftStore } from '../workspace/workspace-draft.store';
import {
  documentMetadata,
  kindScope,
  parseLabel,
  stepOfIssue,
  validResourceName,
  withDocumentLabel,
  withDocumentMetadata,
  wizardSteps,
} from './create-wizard';

function draftStoreStub(draft: Draft | null = null) {
  return {
    active: signal<Draft | null>(draft),
    drafts: signal<Draft[]>(draft ? [draft] : []),
    preview: signal(null),
    conflicts: signal([]),
    busy: signal(false),
    error: signal<string | null>(null),
    changedByOthers: signal(false),
    upsert: jest.fn().mockResolvedValue(true),
    remove: jest.fn().mockResolvedValue(true),
    revert: jest.fn().mockResolvedValue(true),
    rename: jest.fn(),
    open: jest.fn(),
    create: jest.fn(),
    runPreview: jest.fn().mockResolvedValue(null),
    submit: jest.fn().mockResolvedValue({ id: 'plan-1' }),
    discard: jest.fn(),
    resolve: jest.fn(),
    dismissError: jest.fn(),
  };
}

const DRAFT: Draft = {
  id: 'd1',
  title: 'Scale web',
  owner: 'u',
  projects: ['shop'],
  clusterScope: null,
  ops: [
    {
      op: 'upsert',
      kind: 'Deployment',
      name: 'web',
      project: 'shop',
      document: 'x',
      baseGeneration: 1,
      by: 'u',
      at: '',
    },
    { op: 'delete', kind: 'Volume', name: 'old', project: 'shop', baseGeneration: 2, by: 'u', at: '' },
  ],
  version: 1,
  status: 'open',
  planId: null,
  createdAt: '',
  updatedAt: '',
};

describe('create wizard (P3)', () => {
  it('splits every kind into its typed steps; empty steps are skipped, the rest is General', () => {
    const vm = wizardSteps('VirtualMachine', ['description', 'image', 'cpu', 'memory', 'runStrategy', 'nics']);

    expect(vm.map((s) => s.id)).toEqual(['general', 'source', 'hardware', 'network', 'placement', 'review']);
    expect(vm[0].keys).toEqual(['description']);
    expect(vm[2].keys).toEqual(['cpu', 'memory']);
    expect(wizardSteps('DnsRecord', ['zone', 'name', 'type', 'values']).map((s) => s.id)).toEqual([
      'general',
      'record',
      'review',
    ]);
    // Few fields: General only.
    expect(wizardSteps('Node', ['site', 'labels']).map((s) => [s.id, s.keys])).toEqual([
      ['general', ['site', 'labels']],
      ['review', []],
    ]);
    // Unknown kinds: one Settings step.
    expect(wizardSteps('Custom', ['a']).map((s) => s.id)).toEqual(['general', 'spec', 'review']);
    expect(wizardSteps('Custom', []).map((s) => s.id)).toEqual(['general', 'review']);
    expect(kindScope('Deployment')).toBe('project');
    expect(kindScope('Cluster')).toBe('cluster');
    expect(kindScope('Policy')).toBe('any');
  });

  it('edits metadata and labels in the YAML and validates names and labels', () => {
    const doc = withDocumentMetadata('apiVersion: v1\nkind: Volume\nmetadata:\n  name: x\nspec: {}\n', 'data', 'shop');

    expect(documentMetadata(doc)).toEqual({ name: 'data', project: 'shop' });
    expect(documentMetadata(withDocumentMetadata(doc, 'data', null))).toEqual({ name: 'data', project: null });
    expect(withDocumentLabel(doc, 'tier', 'db')).toContain('tier: db');
    expect(validResourceName('web-1')).toBe(true);
    expect(validResourceName('Web')).toBe(false);
    expect(parseLabel('tier=db')).toEqual({ key: 'tier', value: 'db' });
    expect(parseLabel('nope')).toBeNull();
    expect(draftChipCount(DRAFT.ops)).toBe(2);
    expect(previewRisks({ shop: ['pin', 'quota'] })).toEqual([{ project: 'shop', reasons: 'pin, quota' }]);
  });

  it('maps validation issues to their wizard step', () => {
    const steps = wizardSteps('VirtualMachine', ['description', 'image', 'cpu']);

    expect(stepOfIssue(steps, ['metadata', 'name'])).toBe('general');
    expect(stepOfIssue(steps, ['spec', 'cpu', 'vcpus'])).toBe('hardware');
    expect(stepOfIssue(steps, ['spec'], 'missing property "image"')).toBe('source');
    expect(stepOfIssue(steps, ['spec', 'unknownThing'])).toBe('review');
    // A union at the spec root (BackupTarget): its one step.
    expect(stepOfIssue(wizardSteps('BackupTarget', ['type', 'host']), ['spec'], 'matches none')).toBe('target');
    expect(stepOfIssue(steps, [])).toBe('review');
  });
});

describe('LoadweaverDraftTrayComponent', () => {
  it('shows the chip count and the ops, reverts one and submits as a plan', async () => {
    const draft = draftStoreStub(DRAFT);

    TestBed.configureTestingModule({
      imports: [LoadweaverDraftTrayComponent],
      providers: [provideRouter([]), { provide: WorkspaceDraftStore, useValue: draft }],
    });

    const navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(LoadweaverDraftTrayComponent);

    fixture.detectChanges();

    const tray = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('[data-testid="console-draft-chip"]')?.textContent).toContain('2');
    tray.open.set(true);
    fixture.detectChanges();
    expect(document.body.querySelectorAll('[data-testid="draft-tray-ops"] fpc-list-item')).toHaveLength(2);
    expect(tray.opRoute(DRAFT.ops[0])).toEqual(['/resources', 'deployment', 'shop', 'web']);

    (document.body.querySelector('[data-testid="draft-tray-revert-old"] .btn') as HTMLButtonElement).click();
    expect(draft.revert).toHaveBeenCalledWith(DRAFT.ops[1]);

    await tray.submit();
    expect(navigate).toHaveBeenCalledWith(['/activity/plans', 'plan-1']);
    expect(tray.open()).toBe(false);
  });
});
