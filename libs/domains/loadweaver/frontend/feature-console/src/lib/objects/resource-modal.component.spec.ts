jest.mock('ngx-monaco-editor-v2', () => jest.requireActual('../resources/monaco-stub'));

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import {
  type AccessMe,
  ConsoleAccessFacade,
  ConsoleEndpointService,
  ConsoleGitFacade,
  type ConsoleResource,
  ConsoleResourcesFacade,
  type Draft,
  type GitConnection,
  type JsonSchema,
  ResourcesService,
  resourceToYaml,
} from '@forepath/loadweaver/frontend/data-access-console';
import { of, throwError } from 'rxjs';

import { DraftTrayService } from '../nav/draft-tray.component';
import { accessStub, facadeStub, gitStub, testGitConnection } from '../testing';
import { WorkspaceDraftStore } from '../workspace/workspace-draft.store';
import { LoadweaverResourceModalComponent, wizardEnterTarget } from './resource-modal.component';
import { openCreateModalGuard, ResourceModalService } from './resource-modal.service';

const name = { type: 'string', minLength: 1, pattern: '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$' };
const envelope = (kind: string, spec: JsonSchema): JsonSchema => ({
  type: 'object',
  properties: {
    apiVersion: { const: 'loadweaver.com/v1' },
    kind: { const: kind },
    metadata: { type: 'object', properties: { name, project: name }, required: ['name'] },
    spec,
  },
  required: ['apiVersion', 'kind', 'metadata', 'spec'],
  additionalProperties: false,
});
const allow = envelope('Allow', {
  type: 'object',
  properties: { from: { type: 'string' }, to: { type: 'string' } },
  required: ['from', 'to'],
});
const schemas: Record<string, JsonSchema> = {
  Allow: allow,
  Policy: envelope('Policy', {
    type: 'object',
    properties: { from: { type: 'string' }, to: { type: 'string' } },
    required: ['from', 'to'],
  }),
  Deployment: envelope('Deployment', {
    type: 'object',
    properties: { compose: { type: 'string', minLength: 1 } },
    required: ['compose'],
    additionalProperties: false,
  }),
};
const deployment: ConsoleResource = {
  apiVersion: 'loadweaver.com/v1',
  kind: 'Deployment',
  metadata: { name: 'web', project: 'shop' },
  spec: { compose: 'services:\n  web:\n    image: nginx:1.27\n' },
};
const WEB = { kind: 'Deployment', name: 'web', project: 'shop' };
const developer: AccessMe = { userId: 'u', clusterRole: null, projects: { shop: 'developer' } };

function draftStoreStub(active: Draft | null = null) {
  return {
    active: signal<Draft | null>(active),
    error: signal<string | null>(null),
    upsert: jest.fn().mockResolvedValue(true),
    remove: jest.fn().mockResolvedValue(true),
    runPreview: jest.fn().mockResolvedValue(null),
  };
}

describe('LoadweaverResourceModalComponent (create / edit as a modal, 2026-10-29)', () => {
  let fixture: ComponentFixture<LoadweaverResourceModalComponent>;
  let modal: LoadweaverResourceModalComponent;
  let service: ResourceModalService;
  let facade: ReturnType<typeof facadeStub>;
  let draft: ReturnType<typeof draftStoreStub>;
  let api: { get: jest.Mock };
  let tray: DraftTrayService;
  let navigate: jest.SpyInstance;

  function setup(
    me: AccessMe | null = developer,
    {
      active = null as Draft | null,
      connections = [] as GitConnection[],
      endpoints = null as { fleetMode: boolean; activeClusterId: () => string | null } | null,
    } = {},
  ) {
    facade = facadeStub(
      {
        kinds$: [
          { kind: 'Deployment', description: 'Docker Compose project' },
          { kind: 'Policy', description: 'Allow rule' },
          { kind: 'Allow', description: 'A kind without a starter spec' },
        ],
        schemas$: schemas,
        schemaErrors$: {},
        planning$: false,
        planError$: null,
        projects$: ['shop'],
      },
      ['loadKinds', 'loadSchema', 'plan', 'clearPlanError'],
    );
    draft = draftStoreStub(active);
    api = { get: jest.fn().mockReturnValue(of(deployment)) };
    tray = new DraftTrayService();

    TestBed.configureTestingModule({
      imports: [LoadweaverResourceModalComponent],
      providers: [
        provideRouter([]),
        { provide: ConsoleResourcesFacade, useValue: facade },
        { provide: ConsoleAccessFacade, useValue: accessStub(me) },
        { provide: ConsoleGitFacade, useValue: gitStub(connections) },
        { provide: ResourcesService, useValue: api },
        { provide: WorkspaceDraftStore, useValue: draft },
        { provide: DraftTrayService, useValue: tray },
        ...(endpoints ? [{ provide: ConsoleEndpointService, useValue: endpoints }] : []),
      ],
    });

    navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    service = TestBed.inject(ResourceModalService);
    fixture = TestBed.createComponent(LoadweaverResourceModalComponent);
    modal = fixture.componentInstance;
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const render = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  it('Kind step: one single-selection table of all kinds; search, pick enables Next, Enter picks and moves on', async () => {
    setup();
    service.openCreate(null);
    await render();

    const table = () => el().querySelector('[data-testid="resource-modal-kinds"]') as HTMLElement;
    const rows = () => Array.from(table().querySelectorAll<HTMLElement>('tbody > tr.fpc-data-table__row'));

    // Every published kind, readable names sorted, with description and scope; radios, no select-all.
    expect(el().querySelector('[data-testid="resource-modal-other-kind"]')).toBeNull();
    expect(rows().map((row) => row.dataset['rowId'])).toEqual(['Allow', 'Deployment', 'Policy']);
    expect(rows()[1].textContent).toContain('Docker Compose project');
    expect(rows()[1].textContent).toContain('Project');
    expect(rows()[2].textContent).toContain('Cluster or project');
    expect(rows()[1].querySelector('i.bi-box-seam')).not.toBeNull();
    expect(rows().every((row) => (row.querySelector('input') as HTMLInputElement).type === 'radio')).toBe(true);
    expect(table().querySelector('[data-testid="fpc-data-table-select-all"]')).toBeNull();
    expect(modal.canNext()).toBe(false);

    // Search narrows the rows (readable name, id, description).
    modal.kindQuery.set('compose');
    await render();
    expect(rows().map((row) => row.dataset['rowId'])).toEqual(['Deployment']);
    modal.kindQuery.set('');
    await render();

    // A row click picks the kind: Next on, the sidebar shows it, still on the Kind step.
    rows()[1].click();
    await render();
    expect(modal.chosenKind()).toBe('Deployment');
    expect(modal.step()?.id).toBe('kind');
    expect(modal.canNext()).toBe(true);
    expect((rows()[1].querySelector('input') as HTMLInputElement).checked).toBe(true);
    expect(el().querySelector('[data-testid="resource-modal-summary"]')?.textContent).toContain('Deployment');

    // Enter on a row picks it and moves on exactly one step.
    rows()[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await render();
    expect(modal.chosenKind()).toBe('Policy');
    expect(modal.step()?.id).toBe('general');
  });

  it('Kind step: double click picks and moves on; a preset kind skips the step', async () => {
    setup();
    service.openCreate(null);
    await render();

    const row = el().querySelector('[data-testid="resource-modal-kinds"] tr[data-row-id="Deployment"]') as HTMLElement;

    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await render();
    expect(modal.chosenKind()).toBe('Deployment');
    expect(modal.step()?.id).toBe('general');

    service.close();
    await render();
    service.openCreate('Deployment');
    await render();
    expect(modal.wizard().some((s) => s.id === 'kind')).toBe(false);
    expect(modal.step()?.id).toBe('general');
    expect(el().querySelector('[data-testid="resource-modal-kinds"]')).toBeNull();
  });

  it('opens from Create ▾ without a kind: Kind → General → Settings → Review, then adds to the draft', async () => {
    setup();
    service.openCreate(null);
    await render();

    // Order plan's step indicator (no fpc-stepper band), no fullscreen toggle.
    expect(el().querySelector('[data-testid="resource-modal-steps"] ol')).not.toBeNull();
    expect(el().querySelector('[data-testid="resource-modal-expand"]')).toBeNull();
    expect(modal.wizard()[0].id).toBe('kind');
    expect(modal.canNext()).toBe(false);

    modal.chooseKind('Allow');
    await render();
    // A developer of one project: the template lands in that project (cluster-level isn't allowed).
    expect(modal.text()).toContain('kind: Allow');
    expect(modal.meta().project).toBe('shop');
    expect(modal.clusterLevelAllowed()).toBe(false);
    expect(modal.wizard().map((s) => s.id)).toEqual(['kind', 'general', 'spec', 'review']);
    expect(facade['loadSchema']).toHaveBeenCalledWith('Allow');

    modal.next();
    expect(modal.step()?.id).toBe('general');

    // Step validation: an invalid name blocks General.
    modal.setName('Bad Name');
    await render();
    expect(modal.stepperSteps()[1].invalid).toBe(true);
    expect(modal.nameError()).not.toBeNull();
    expect(modal.canNext()).toBe(false);
    modal.setName('allow-web');
    expect(modal.canNext()).toBe(true);
    modal.next();

    // Settings: the missing spec fields are this step's compiler diagnostics.
    await render();
    expect(modal.step()?.id).toBe('spec');
    // In the form's words, not raw paths: "From: Required".
    expect(modal.stepIssues().map((i) => i.message)).toEqual(['From: Required', 'To: Required']);
    expect(el().querySelector('[data-testid="resource-modal-step-issues"]')).not.toBeNull();
    expect(modal.canNext()).toBe(false);

    modal.text.set(modal.text().replace('spec: {}', 'spec:\n  from: a\n  to: b'));
    expect(modal.stepIssues()).toEqual([]);
    modal.next();
    await render();

    // Review: what goes into the draft.
    expect(modal.step()?.id).toBe('review');
    const review = el().querySelector('[data-testid="resource-modal-review"]')?.textContent ?? '';

    expect(review).toContain('allow-web');
    expect(review).toContain('shop');
    // The readable summary of the settings (labels, not paths) and the sidebar.
    expect(modal.reviewSections().map((s) => s.rows.map((r) => [r.label, r.value]))).toEqual([
      [
        ['From', 'a'],
        ['To', 'b'],
      ],
    ]);
    expect(el().querySelector('[data-testid="resource-modal-summary"]')?.textContent).toContain('allow-web');
    expect(el().querySelector('[data-testid="resource-modal-status"]')?.textContent).toContain('Ready for the draft');
    // The YAML only behind "Show YAML".
    expect(el().querySelector('[data-testid="resource-modal-review-yaml"]')).toBeNull();
    modal.showYaml.set(true);
    await render();
    expect(el().querySelector('[data-testid="resource-modal-review-yaml"]')).not.toBeNull();
    expect(modal.canFinish()).toBe(true);

    await modal.finish();

    // The same payload as the old wizard: the document into the draft, preview, the new object's page.
    expect(draft.upsert).toHaveBeenCalledWith(expect.stringContaining('name: allow-web'));
    expect(draft.remove).not.toHaveBeenCalled();
    expect(draft.runPreview).toHaveBeenCalled();
    expect(tray.open()).toBe(true);
    expect(service.request()).toBeNull();
    expect(navigate).toHaveBeenCalledWith(['/resources', 'allow', 'shop', 'allow-web']);
  });

  it('opens from Edit pre-filled with the drafted version, saves a rename as upsert + delete of the old', async () => {
    const drafted = resourceToYaml(deployment).replace('nginx:1.27', 'nginx:1.29');

    setup(developer, {
      active: {
        id: 'd1',
        title: 'Scale web',
        ops: [{ op: 'upsert', ...WEB, document: drafted }],
      } as unknown as Draft,
    });
    service.openEdit(WEB);
    await render();

    expect(api.get).toHaveBeenCalledWith(WEB);
    expect(modal.wizard()[0].id).toBe('general');
    expect(modal.text()).toContain('nginx:1.29');
    expect(modal.liveText()).toContain('nginx:1.27');
    expect(modal.title()).toBe('Edit resource');

    // Unchanged: the Review step can't save yet.
    expect(modal.stepperSteps().at(-1)?.invalid).toBe(true);

    modal.setName('shop-web');
    expect(modal.renamed()).toBe(true);
    modal.active.set(modal.wizard().length - 1);
    modal.showYaml.set(true);
    await render();
    expect(el().querySelector('[data-testid="resource-modal-renamed"]')?.textContent).toContain(
      'Deployment shop/shop-web',
    );
    expect(el().querySelector('[data-testid="resource-modal-diff"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="resource-modal-finish"]')?.textContent).toContain('Save to draft');

    await modal.finish();

    expect(draft.upsert).toHaveBeenCalledWith(expect.stringContaining('name: shop-web'));
    expect(draft.remove).toHaveBeenCalledWith(WEB);
    // Edits don't preview by default; the renamed resource's page opens.
    expect(draft.runPreview).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/resources', 'deployment', 'shop', 'shop-web']);
  });

  it("links the project's VM images; in fleet mode through the cluster entry (a new tab has no active cluster)", () => {
    const cluster = '0b6c7c1e-1d2f-4a8e-9a43-5d2b3a1f9e10';

    setup(developer, { endpoints: { fleetMode: true, activeClusterId: () => cluster } });
    modal.text.set(resourceToYaml(deployment));
    expect(modal.imagesLink()).toEqual(['/clusters', cluster, 'resources', 'project', 'shop']);

    TestBed.resetTestingModule();
    setup();
    modal.text.set(resourceToYaml(deployment));
    expect(modal.imagesLink()).toEqual(['/resources', 'project', 'shop']);
  });

  it('puts a VM image picked under "Recommended images" into spec.image (3.42)', () => {
    setup();
    modal.text.set(
      resourceToYaml({
        kind: 'VirtualMachine',
        metadata: { name: 'vm1', project: 'shop' },
        spec: { image: '', firmware: 'uefi' },
      } as ConsoleResource),
    );
    modal.setVmImage('registry.lw/shop/debian:13');

    expect(modal.text()).toContain('image: registry.lw/shop/debian:13');
    expect(modal.text()).toContain('firmware: uefi');
    expect(modal.meta()).toMatchObject({ name: 'vm1', project: 'shop' });
  });

  it('YAML is one page: no step list or "Step X of Y", the final actions right away, Back only to Kind', async () => {
    setup();
    service.openCreate(null);
    await render();
    expect(modal.title()).toBe('Create resource');
    modal.chooseKind('Allow');
    await render();
    modal.next();
    await render();

    const atStep = modal.active();

    expect(el().querySelector('[data-testid="resource-modal-steps"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="resource-modal-step-of"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="resource-modal-next"]')).not.toBeNull();

    modal.yaml.set(true);
    await render();
    expect(modal.yamlPage()).toBe(true);
    expect(el().querySelector('[data-testid="resource-modal-steps"]')).toBeNull();
    expect(el().querySelector('[data-testid="resource-modal-step-of"]')).toBeNull();
    expect(el().querySelector('[data-testid="resource-modal-next"]')).toBeNull();
    expect(el().querySelector('[data-testid="resource-modal-finish"]')).not.toBeNull();

    // Back from the YAML page leads to the kind; Form comes back on the step it was on.
    modal.back();
    expect(modal.step()?.id).toBe('kind');
    modal.active.set(atStep);
    modal.yaml.set(false);
    await render();
    expect(modal.active()).toBe(atStep);
    expect(el().querySelector('[data-testid="resource-modal-steps"]')).not.toBeNull();
  });

  it('starts from the live document and says so when it cannot be loaded', async () => {
    setup();
    api.get.mockReturnValue(throwError(() => new Error('404')));
    service.openEdit(WEB);
    await render();

    expect(el().querySelector('[data-testid="resource-modal-load-error"]')).not.toBeNull();
    expect(modal.canFinish()).toBe(false);
  });

  it('keeps Form and YAML in sync (one document), compose file included', async () => {
    setup();
    service.openEdit(WEB);
    await render();

    (el().querySelector('[data-testid="resource-modal-yaml-toggle"] button') as HTMLButtonElement).click();
    await render();
    expect(modal.yaml()).toBe(true);
    expect(el().querySelector('[data-testid="resource-modal-yaml"]')).not.toBeNull();

    // YAML edit → the form's name field.
    modal.text.set(modal.text().replace('name: web', 'name: web-2'));
    expect(modal.meta().name).toBe('web-2');

    // Compose file editor writes spec.compose.
    modal.document.set('compose');
    await render();
    expect(el().querySelector('[data-testid="resource-modal-compose"]')).not.toBeNull();
    modal.onComposeChange('services:\n  web:\n    image: nginx:1.30\n');
    expect(modal.text()).toContain('nginx:1.30');

    // Form edit → the YAML.
    (el().querySelector('[data-testid="resource-modal-form-toggle"] button') as HTMLButtonElement).click();
    await render();
    modal.setName('web-3');
    expect(modal.text()).toContain('name: web-3');
  });

  it('shows compiler diagnostics and blocks the draft on errors', async () => {
    setup();
    service.openCreate('Policy', 'shop');
    await render();

    modal.text.set('kind: [');
    modal.yaml.set(true);
    await render();

    expect(modal.errorCount()).toBeGreaterThan(0);
    expect(modal.stepperSteps().at(-1)?.invalid).toBe(true);
    expect(el().querySelector('[data-testid="resource-modal-problems"]')).not.toBeNull();
    expect(modal.canFinish()).toBe(false);

    // Compose problems of a Deployment count too.
    modal.text.set(resourceToYaml({ ...deployment, spec: { compose: 'services:\n  web:\n    build: .\n' } }));
    expect(modal.problems().map((p) => [p.source, p.message])).toContainEqual([
      'compose',
      'services.web: missing property "image" (build is not supported)',
    ]);
  });

  describe('closing with changes: the modal swaps with "Discard changes?" (Agenstra pattern, 2026-10-29)', () => {
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const escape = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    const modals = () => Array.from(document.querySelectorAll('.fpc-modal__modal'));
    const confirm = () => document.querySelector('[data-testid="resource-modal-discard"] .fpc-modal__modal');
    const main = () => document.querySelector('[data-testid="resource-modal"] .fpc-modal__modal');
    const nameInput = () => document.querySelector<HTMLInputElement>('#lw-resource-modal-name');
    /** Lets the swap run: modal fade out, confirm fade in. */
    const settle = async () => {
      await render();
      await wait(220);
      await render();
      await wait(120);
      await render();
    };

    async function openDirty(): Promise<void> {
      setup();
      service.openCreate('Policy', 'shop');
      await render();
      modal.setName('changed');
      await render();
    }

    it('closes directly when clean (no confirm)', async () => {
      setup();
      service.openCreate('Policy', 'shop');
      await render();

      modal.requestClose();
      await render();

      expect(service.request()).toBeNull();
      expect(modal.discardOpen()).toBe(false);
      expect(modal.closeSwap.suspended()).toBe(false);
    });

    it('Escape with changes hides the modal, then shows the confirm in its place (one modal at a time)', async () => {
      await openDirty();
      escape();
      fixture.detectChanges();

      // The modal fades out first; the confirm follows once the fade has run.
      expect(modal.modalShown()).toBe(false);
      expect(modal.discardOpen()).toBe(false);
      expect(service.request()).not.toBeNull();

      await settle();

      expect(modal.discardOpen()).toBe(true);
      expect(main()).toBeNull();
      expect(confirm()).not.toBeNull();
      expect(modals()).toHaveLength(1);
      expect(document.querySelectorAll('.fpc-modal__backdrop')).toHaveLength(1);
      expect(confirm()?.textContent).toContain('Discard changes?');
    });

    it('"Keep editing" brings the modal back as it was (step, document, focus)', async () => {
      await openDirty();
      const step = modal.active();
      nameInput()?.focus();
      (document.querySelector('[data-testid="resource-modal"] .btn-close') as HTMLButtonElement).click();
      await settle();
      expect(modal.discardOpen()).toBe(true);

      const keep = Array.from(confirm()?.querySelectorAll('button') ?? []).find((b) =>
        b.textContent?.includes('Keep editing'),
      );
      keep?.click();
      await settle();

      expect(modal.discardOpen()).toBe(false);
      expect(modal.modalShown()).toBe(true);
      expect(confirm()).toBeNull();
      expect(modals()).toHaveLength(1);
      expect(modal.active()).toBe(step);
      expect(modal.meta().name).toBe('changed');
      expect(nameInput()?.value).toBe('changed');
      expect(document.activeElement).toBe(nameInput());
      expect(service.request()).not.toBeNull();
    });

    it('Escape on the confirm keeps editing (and does not re-ask)', async () => {
      await openDirty();
      escape();
      await settle();
      expect(modal.discardOpen()).toBe(true);

      escape();
      await settle();

      expect(modal.discardOpen()).toBe(false);
      expect(modal.modalShown()).toBe(true);
      expect(modal.meta().name).toBe('changed');

      // Asking again works.
      escape();
      await settle();
      expect(modal.discardOpen()).toBe(true);
    });

    it('"Discard" closes everything and the next open starts fresh', async () => {
      await openDirty();
      modal.requestClose();
      await settle();

      modal.discard();
      await settle();

      expect(service.request()).toBeNull();
      expect(modal.discardOpen()).toBe(false);
      expect(modal.closeSwap.suspended()).toBe(false);
      expect(modals()).toHaveLength(0);
      expect(draft.upsert).not.toHaveBeenCalled();

      service.openCreate('Policy', 'shop');
      await render();
      expect(modal.meta().name).not.toBe('changed');
      expect(modal.modalShown()).toBe(true);
    });
  });

  it('moves on with Enter in a field, not in multi-line fields, buttons or the code editor', async () => {
    setup();
    service.openCreate('Policy', 'shop');
    await render();
    modal.setName('allow-web');

    const input = document.createElement('input');
    const textarea = document.createElement('textarea');

    expect(wizardEnterTarget(input)).toBe(true);
    expect(wizardEnterTarget(textarea)).toBe(false);
    expect(wizardEnterTarget(document.createElement('button'))).toBe(false);

    const event = { target: input, preventDefault: jest.fn() } as unknown as Event;

    modal.onEnter(event);
    // Policy's typed steps: General → Sources & destinations → Review.
    expect(modal.step()?.id).toBe('peers');
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('gates by role: a viewer may not create in the project', async () => {
    setup({ userId: 'v', clusterRole: null, projects: { shop: 'viewer' } });
    service.openCreate('Policy', 'shop');
    await render();

    expect(modal.permitted()).toBe(false);
    expect(modal.stepperSteps()[0].invalid).toBe(true);
    expect(el().querySelector('[data-testid="resource-modal-forbidden"]')).not.toBeNull();
    expect(modal.canFinish()).toBe(false);
  });

  it('plans now (pull request wording in a Git-authoritative scope) and closes once planned', async () => {
    setup(developer, { connections: [testGitConnection({ mode: 'authoritative' })] });
    service.openEdit(WEB);
    await render();
    modal.setName('shop-web');
    modal.active.set(modal.wizard().length - 1);
    await render();

    expect(el().querySelector('[data-testid="resource-modal-git-authoritative"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="resource-modal-plan"]')?.textContent).toContain(
      'Plan and open pull request',
    );

    modal.planNow();
    expect(facade['plan']).toHaveBeenCalledWith({
      documents: modal.text(),
      delete: [{ kind: 'Deployment', name: 'web', project: 'shop' }],
    });

    (facade['planning$'] as unknown as { next(v: boolean): void }).next(true);
    await render();
    (facade['planning$'] as unknown as { next(v: boolean): void }).next(false);
    await render();
    expect(service.request()).toBeNull();
  });

  it('moves on only over valid steps; a project kind needs its project', async () => {
    setup({ userId: 'a', clusterRole: 'cluster-admin', projects: {} });
    (facade['projects$'] as unknown as { next(v: string[]): void }).next([]);
    service.openCreate('Deployment', null);
    await render();

    // Deployments belong to a project: no "Cluster-level", General blocks until one is chosen.
    expect(modal.scope()).toBe('project');
    expect(modal.clusterLevelAllowed()).toBe(false);
    expect(modal.meta().project).toBeNull();
    expect(modal.projectError()).not.toBeNull();
    expect(modal.canNext()).toBe(false);
    expect(modal.status()).toBe('incomplete');
    modal.goTo(2);
    expect(modal.active()).toBe(0);

    modal.setProject('shop');
    expect(modal.canNext()).toBe(true);
    modal.next();
    expect(modal.step()?.id).toBe('workload');
    // Back always works.
    modal.back();
    expect(modal.step()?.id).toBe('general');
    modal.goTo(1);
    expect(modal.step()?.id).toBe('workload');

    // An invalid workload (empty compose) blocks Next and shows the problem at the step.
    modal.text.set(modal.text().replace(/compose: [\s\S]*$/, 'compose: ""\n'));
    await render();
    expect(modal.stepperSteps()[1].invalid).toBe(true);
    expect(modal.canNext()).toBe(false);
    expect(el().querySelector('[data-testid="resource-modal-step-issues"]')?.textContent).toContain('Compose file');
  });

  it('opens over the parent page from the /create deep links', () => {
    setup();

    const router = TestBed.inject(Router);
    const tree = TestBed.runInInjectionContext(() =>
      openCreateModalGuard(
        {
          paramMap: { get: (k: string) => (k === 'kind' ? 'Volume' : null) },
          queryParamMap: { get: (k: string) => (k === 'project' ? 'shop' : null) },
        } as never,
        {} as never,
      ),
    );

    expect(service.request()).toEqual({ mode: 'create', kind: 'Volume', project: 'shop' });
    expect(router.serializeUrl(tree as never)).toBe('/resources/project/shop');
  });
});
