jest.mock('ngx-monaco-editor-v2', () => jest.requireActual('./monaco-stub'));

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleGitFacade,
  type ConsoleResource,
  type GitConnection,
  ConsoleResourcesFacade,
  type JsonSchema,
} from '@forepath/loadweaver/frontend/data-access-console';
import { BehaviorSubject, of } from 'rxjs';

import { accessStub, facadeStub, gitStub, testGitConnection } from '../testing';
import { LoadweaverResourceEditorPageComponent } from './resource-editor-page.component';

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
const schemas: Record<string, JsonSchema> = {
  Policy: envelope('Policy', { type: 'object', required: ['from', 'to', 'rules'] }),
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

describe('LoadweaverResourceEditorPageComponent', () => {
  let fixture: ComponentFixture<LoadweaverResourceEditorPageComponent>;
  let facade: ReturnType<typeof facadeStub>;
  let git: ReturnType<typeof gitStub>;

  async function setup(
    params: Record<string, string>,
    query: Record<string, string>,
    connections: GitConnection[] = [],
  ) {
    git = gitStub(connections);
    facade = facadeStub(
      {
        kinds$: [
          { kind: 'Deployment', description: 'Docker Compose project' },
          { kind: 'Policy', description: 'Allow rule' },
        ],
        schemas$: schemas,
        schemaErrors$: {},
        selected$: null,
        selectedLoading$: false,
        selectedError$: null,
        planning$: false,
        planError$: null,
      },
      ['loadKinds', 'loadSchema', 'open', 'plan', 'clearPlanError'],
    );

    await TestBed.configureTestingModule({
      imports: [LoadweaverResourceEditorPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of(convertToParamMap(params)), queryParamMap: of(convertToParamMap(query)) },
        },
        { provide: ConsoleResourcesFacade, useValue: facade },
        { provide: ConsoleGitFacade, useValue: git },
        {
          provide: ConsoleAccessFacade,
          useValue: accessStub({ userId: 'u', clusterRole: null, projects: { shop: 'developer' } }),
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadweaverResourceEditorPageComponent);
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;

  it('starts a new resource from the template of its kind and plans it', async () => {
    await setup({}, { kind: 'Policy', project: 'shop' });

    const component = fixture.componentInstance;

    expect(facade['loadKinds']).toHaveBeenCalled();
    expect(facade['loadSchema']).toHaveBeenCalledWith('Policy');
    expect(component.text()).toContain('kind: Policy');
    expect(component.text()).toContain('project: shop');
    expect(component.errorCount()).toBe(0);
    expect(component.canPlan()).toBe(true);

    component.plan();

    expect(facade['plan']).toHaveBeenCalledWith({ documents: component.text() });
  });

  it('shows schema violations by line and blocks planning', async () => {
    await setup({}, { kind: 'Policy' });

    const component = fixture.componentInstance;

    component.onTextChange('apiVersion: loadweaver.com/v1\nkind: Policy\nmetadata:\n  name: Bad_Name\nspec: {}\n');
    fixture.detectChanges();

    expect(component.errorCount()).toBeGreaterThan(0);
    expect(component.canPlan()).toBe(false);

    const problems = el().querySelector('[data-testid="editor-problems"]')?.textContent ?? '';

    expect(problems).toContain('metadata.name: must match');
    expect(problems).toContain('spec: missing property "from"');
    expect(component.problems().find((p) => p.message.startsWith('metadata.name'))?.line).toBe(4);

    component.plan();
    expect(facade['plan']).not.toHaveBeenCalled();
  });

  it('reports YAML syntax errors', async () => {
    await setup({}, { kind: 'Policy' });

    fixture.componentInstance.onTextChange('kind: [');
    fixture.detectChanges();

    expect(fixture.componentInstance.errorCount()).toBeGreaterThan(0);
  });

  it('switches the kind of a new resource', async () => {
    await setup({}, {});

    const component = fixture.componentInstance;

    expect(component.kind()).toBe('Deployment');
    component.changeKind('Policy');
    expect(component.text()).toContain('kind: Policy');
    expect(component.text()).not.toContain('project:');
  });

  it('edits a deployment, its compose file and plans a rename with the deletion', async () => {
    await setup({ kind: 'Deployment', name: 'web' }, { project: 'shop' });

    const component = fixture.componentInstance;

    expect(facade['open']).toHaveBeenCalledWith({ kind: 'Deployment', name: 'web', project: 'shop' });
    expect(component.initialText()).toBeNull();

    (facade['selected$'] as BehaviorSubject<unknown>).next(deployment);
    fixture.detectChanges();

    expect(component.compose()).toContain('nginx:1.27');
    expect(component.canPlan()).toBe(false);

    component.onComposeChange('services:\n  web:\n    image: nginx:1.28\n');
    fixture.detectChanges();

    expect(component.text()).toContain('nginx:1.28');
    expect(component.dirty()).toBe(true);
    expect(component.renamed()).toBe(false);

    component.onTextChange(component.text().replace('name: web', 'name: shop-web'));
    fixture.detectChanges();

    expect(component.renamed()).toBe(true);
    expect(el().querySelector('[data-testid="editor-renamed"]')?.textContent).toContain('Deployment shop/shop-web');

    component.plan();

    expect(facade['plan']).toHaveBeenCalledWith({
      documents: component.text(),
      delete: [{ kind: 'Deployment', name: 'web', project: 'shop' }],
    });
  });

  it('seeds the editor only from the fresh GET, not from a stale copy in the store', async () => {
    await setup({ kind: 'Deployment', name: 'web' }, { project: 'shop' });

    const component = fixture.componentInstance;
    const stale = { ...deployment, spec: { compose: 'services:\n  web:\n    image: nginx:1.20\n' } };

    (facade['selectedLoading$'] as BehaviorSubject<unknown>).next(true);
    (facade['selected$'] as BehaviorSubject<unknown>).next(stale);
    fixture.detectChanges();

    expect(component.initialText()).toBeNull();
    expect(component.canPlan()).toBe(false);

    (facade['selected$'] as BehaviorSubject<unknown>).next(deployment);
    (facade['selectedLoading$'] as BehaviorSubject<unknown>).next(false);
    fixture.detectChanges();

    expect(component.text()).toContain('nginx:1.27');
    expect(component.text()).not.toContain('nginx:1.20');
  });

  it('flags compose files without images', async () => {
    await setup({ kind: 'Deployment', name: 'web' }, { project: 'shop' });

    (facade['selected$'] as BehaviorSubject<unknown>).next(deployment);
    fixture.detectChanges();
    fixture.componentInstance.activeTab.set('compose');
    fixture.detectChanges();
    fixture.componentInstance.onComposeChange('services:\n  web:\n    build: .\n');
    fixture.detectChanges();

    expect(fixture.componentInstance.problems().map((p) => [p.source, p.message])).toContainEqual([
      'compose',
      'services.web: missing property "image" (build is not supported)',
    ]);
  });

  it('goes back to the resource on cancel', async () => {
    await setup({ kind: 'Deployment', name: 'web' }, { project: 'shop' });

    const navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    fixture.componentInstance.cancel();

    expect(navigate).toHaveBeenCalledWith(['/resources', 'Deployment', 'web'], { queryParams: { project: 'shop' } });
  });

  it('says that saving opens a pull request in a Git-authoritative scope', async () => {
    await setup({}, { kind: 'Policy', project: 'shop' }, [testGitConnection({ mode: 'authoritative' })]);

    const component = fixture.componentInstance;

    expect(git['load']).toHaveBeenCalledWith(true);
    expect(component.gitAuthoritative().map((c) => c.project)).toEqual(['shop']);
    expect(el().querySelector('[data-testid="editor-git-authoritative"]')?.textContent).toContain(
      'saving opens a pull request',
    );
    expect(el().querySelector('[data-testid="editor-plan"]')?.textContent).toContain('Plan and open pull request');

    // Still planned the normal way: the control plane opens the pull request and the plan links it.
    component.plan();
    expect(facade['plan']).toHaveBeenCalled();
  });

  it('plans as usual in a bidirectional scope', async () => {
    await setup({}, { kind: 'Policy', project: 'shop' }, [testGitConnection()]);

    expect(fixture.componentInstance.gitAuthoritative()).toEqual([]);
    expect(el().querySelector('[data-testid="editor-git-authoritative"]')).toBeNull();
  });
});
