jest.mock('ngx-monaco-editor-v2', () => jest.requireActual('../resources/monaco-stub'));

import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { discardPeriodicTasks, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/loadweaver/frontend/util-configuration';
import { resourceJsonSchema } from '@forepath/loadweaver/shared/util-model';

import { documentProject, joinSecretRef, referenceOf, splitSecretRef } from './reference-fields';
import { REFERENCE_DEBOUNCE_MS } from './reference-field.component';
import { formSpec, schemaAt, specSchema } from './schema-form';
import { LoadweaverSchemaFormComponent } from './schema-form.component';

const API = 'https://cp.example.com/api';
const optionText = (o: HTMLElement) =>
  Array.from(o.querySelectorAll('span'))
    .map((s) => s.textContent?.trim())
    .join(' ');

function doc(kind: string, spec: string[], project?: string): string {
  return [
    'apiVersion: loadweaver.com/v1',
    `kind: ${kind}`,
    'metadata:',
    '  name: x',
    ...(project ? [`  project: ${project}`] : []),
    'spec:',
    ...spec.map((l) => `  ${l}`),
    '',
  ].join('\n');
}

const res = (kind: string, name: string, project?: string) => ({
  apiVersion: 'loadweaver.com/v1',
  kind,
  metadata: { name, ...(project ? { project } : {}) },
  spec: {},
});

describe('referenceOf (which spec fields name another object)', () => {
  const at = (kind: string, path: (string | number)[], value?: unknown) =>
    referenceOf(kind, path, schemaAt(specSchema(resourceJsonSchema(kind as never)) ?? {}, path, value) ?? {});

  it.each([
    ['DnsProvider', ['nodeGroup'], { type: 'resource', kind: 'NodeGroup', projectScoped: false }],
    ['DnsProvider', ['nameServers', 'pool'], { type: 'resource', kind: 'IpPool', projectScoped: false }],
    ['DnsZone', ['provider'], { type: 'resource', kind: 'DnsProvider', projectScoped: false }],
    ['DnsZone', ['secondaries', 0], { type: 'resource', kind: 'DnsProvider', projectScoped: false }],
    ['DnsRecord', ['zone'], { type: 'resource', kind: 'DnsZone', projectScoped: false }],
    ['IpPool', ['projects', 0], { type: 'project' }],
    ['Node', ['site'], { type: 'resource', kind: 'Site', projectScoped: false }],
    ['BgpAnnouncement', ['peers', 0], { type: 'resource', kind: 'BgpPeer', projectScoped: false }],
    ['BgpAnnouncement', ['primarySite'], { type: 'resource', kind: 'Site', projectScoped: false }],
    ['BackupPolicy', ['targets', 0], { type: 'resource', kind: 'BackupTarget', projectScoped: false }],
    ['MaintenanceWindow', ['sites', 0], { type: 'resource', kind: 'Site', projectScoped: false }],
    ['VirtualMachine', ['nics', 0, 'groups', 0], { type: 'resource', kind: 'WorkloadGroup', projectScoped: true }],
    ['VirtualMachine', ['cloudInit', 'userDataSecret'], { type: 'secret' }],
    ['Restore', ['backup'], { type: 'backup' }],
    ['Restore', ['target', 'deployment'], { type: 'resource', kind: 'Deployment', projectScoped: true }],
    ['ClientGroup', ['restrictedGroup'], { type: 'resource', kind: 'ClientGroup', projectScoped: false }],
    ['BgpPeer', ['password'], { type: 'secret' }],
    ['Cluster', ['ingress', 'pool'], { type: 'resource', kind: 'IpPool', projectScoped: false }],
    ['Cluster', ['git', 'github', 'privateKey'], { type: 'secret' }],
  ])('%s %j', (kind, path, expected) => {
    expect(at(kind, path)).toEqual(expected);
  });

  it('finds references inside union branches (policy peers, backup targets)', () => {
    expect(at('Policy', ['from', 0, 'group'], { from: [{ group: 'web' }] })).toEqual({
      type: 'resource',
      kind: 'WorkloadGroup',
      projectScoped: true,
    });
    expect(at('Policy', ['to', 0, 'clients'], { to: [{ clients: 'sales' }] })).toEqual({
      type: 'resource',
      kind: 'ClientGroup',
      projectScoped: false,
    });
    expect(at('BackupTarget', ['credentials'], { type: 's3' })).toEqual({ type: 'secret' });
  });

  it('leaves names, hosts and other texts alone', () => {
    expect(at('DnsZone', ['zone'])).toBeNull();
    expect(at('VirtualMachine', ['disks', 0, 'name'])).toBeNull();
    expect(at('VirtualMachine', ['image'])).toBeNull();
  });

  it('splits and joins secret references; reads the document project', () => {
    expect(splitSecretRef('secret://ops/db@3')).toEqual({ project: 'ops', name: 'db@3' });
    expect(splitSecretRef(undefined)).toEqual({ project: '', name: '' });
    expect(joinSecretRef('ops', 'db')).toBe('secret://ops/db');
    expect(joinSecretRef('', '')).toBeUndefined();
    expect(documentProject(doc('Restore', [], 'shop'))).toBe('shop');
    expect(documentProject(doc('Site', []))).toBeNull();
  });
});

describe('reference typeaheads in the generated form (2026-10-29)', () => {
  let http: HttpTestingController;
  let requested: string[];

  beforeEach(() => {
    requested = [];
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(
          withInterceptors([
            (req, next) => {
              requested.push(req.urlWithParams);

              return next(req);
            },
          ]),
        ),
        provideHttpClientTesting(),
        { provide: ENVIRONMENT, useValue: { console: { urls: { restApi: `${API}/` } } } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    // Secret values are never asked for: the only secret call allowed is the names-only list of a project.
    expect(
      requested.filter((url) => /secret/i.test(url) && !/\/projects\/[^/]+\/secrets\/names(\?|$)/.test(url)),
    ).toEqual([]);
    document.body.querySelectorAll('.fpc-typeahead-select__menu').forEach((m) => m.remove());
  });

  function render(kind: string, text: string, keys: string[]) {
    const fixture = TestBed.createComponent(LoadweaverSchemaFormComponent);

    fixture.componentRef.setInput('schema', resourceJsonSchema(kind as never));
    fixture.componentRef.setInput('keys', keys);
    fixture.componentRef.setInput('kindName', kind);
    fixture.componentInstance.text.set(text);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const field = (path: string) => host.querySelector(`[data-field="${path}"]`) as HTMLElement;
    const input = (path: string) =>
      field(path).querySelector('[data-testid="schema-ref-input"] input') as HTMLInputElement;
    const spec = () => formSpec(fixture.componentInstance.text()) as Record<string, unknown>;
    const focus = (path: string) => {
      input(path).dispatchEvent(new Event('focus'));
      fixture.detectChanges();
    };
    const type = (el: HTMLInputElement, value: string) => {
      el.value = value;
      el.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };
    const options = () => Array.from(document.querySelectorAll('[data-testid="schema-ref-option"]')) as HTMLElement[];

    return { fixture, host, field, input, spec, focus, type, options };
  }

  it('renders a typeahead for every kind of reference field', () => {
    const cases: [string, string, string[], string[]][] = [
      ['DnsZone', doc('DnsZone', ['zone: example.com', 'provider: cf']), ['provider'], ['provider']],
      [
        'IpPool',
        doc('IpPool', ['cidrs: [203.0.113.0/24]', 'nodeGroup: edge', 'failover: none', 'projects: [shop]']),
        ['nodeGroup', 'projects'],
        ['nodeGroup', 'projects.0'],
      ],
      [
        'VirtualMachine',
        doc('VirtualMachine', ['nics:', '  - name: eth0', '    groups: [web]'], 'shop'),
        ['nics'],
        ['nics.0.groups.0'],
      ],
      [
        'Restore',
        doc('Restore', ['backup: ""', 'target:', '  deployment: web', '  volume: data'], 'shop'),
        ['backup', 'target'],
        ['backup', 'target.deployment'],
      ],
    ];

    for (const [kind, text, keys, paths] of cases) {
      const { field, input } = render(kind, text, keys);

      for (const path of paths) {
        expect(field(path)).not.toBeNull();
        expect(input(path)).not.toBeNull();
      }
    }

    // Only rendering: nothing was requested yet.
    http.verify();
  });

  it('shows a stored secret reference as project + name', async () => {
    const secret = render('BackupTarget', doc('BackupTarget', ['type: s3', 'credentials: secret://ops/s3']), []);

    await secret.fixture.whenStable();
    secret.fixture.detectChanges();
    expect(secret.field('credentials').querySelector('[data-testid="schema-ref-secret"]')).not.toBeNull();
    expect(secret.input('credentials').value).toBe('ops');
    expect(
      (secret.field('credentials').querySelector('[data-testid="schema-ref-secret-name"] input') as HTMLInputElement)
        .value,
    ).toBe('s3');
    // Only rendering: nothing was requested yet.
    http.verify();
  });

  it('suggests what the caller may see and round-trips the picked value to the YAML', fakeAsync(() => {
    const { fixture, input, spec, focus, type, options } = render(
      'DnsZone',
      doc('DnsZone', ['zone: example.com', 'provider: old']),
      ['provider'],
    );

    expect(input('provider').value).toBe('old');

    focus('provider');
    http.expectOne(`${API}/resources?kind=DnsProvider&limit=20`).flush([res('DnsProvider', 'cloudflare')]);
    fixture.detectChanges();
    expect(options().map(optionText)).toEqual(['cloudflare DNS provider']);

    options()[0].dispatchEvent(new MouseEvent('mousedown'));
    fixture.detectChanges();
    expect(spec()['provider']).toBe('cloudflare');
    expect(fixture.componentInstance.text()).toContain('provider: cloudflare');

    // Typing is free text (YAML follows at once) and asks the server after the debounce.
    type(input('provider'), 'route');
    expect(spec()['provider']).toBe('route');
    tick(REFERENCE_DEBOUNCE_MS - 1);
    http.expectNone((r) => r.urlWithParams.includes('q=route'));
    tick(1);
    http.expectOne(`${API}/resources?kind=DnsProvider&q=route&limit=20`).flush([]);
    fixture.detectChanges();
    expect(document.querySelector('[data-testid="schema-ref-empty"]')?.textContent).toContain(
      'No DNS provider you can see matches.',
    );

    // YAML → form.
    fixture.componentInstance.text.set(doc('DnsZone', ['zone: example.com', 'provider: from-yaml']));
    fixture.detectChanges();
    expect(input('provider').value).toBe('from-yaml');
  }));

  it("lists project-scoped kinds of the resource's own project", fakeAsync(() => {
    const { focus } = render(
      'VirtualMachine',
      doc('VirtualMachine', ['nics:', '  - name: eth0', '    groups: [web]'], 'shop'),
      ['nics'],
    );

    focus('nics.0.groups.0');
    http.expectOne(`${API}/resources?kind=WorkloadGroup&project=shop&limit=20`).flush([]);
  }));

  it('falls back to a plain input with a hint when the list is not permitted (403)', fakeAsync(() => {
    const { fixture, field, input, spec, focus, type, options } = render(
      'DnsZone',
      doc('DnsZone', ['zone: example.com', 'provider: a']),
      ['provider'],
    );

    focus('provider');
    http
      .expectOne((r) => r.url === `${API}/resources`)
      .flush({ message: 'forbidden' }, { status: 403, statusText: 'Forbidden' });
    fixture.detectChanges();

    expect(field('provider').querySelector('[data-testid="schema-ref-denied"]')).not.toBeNull();
    expect(field('provider').querySelector('[role="alert"]')).toBeNull();
    expect(options()).toEqual([]);

    type(input('provider'), 'typed-by-hand');
    tick(REFERENCE_DEBOUNCE_MS);
    http.expectNone((r) => r.url === `${API}/resources`);
    expect(spec()['provider']).toBe('typed-by-hand');
  }));

  it('builds secret references from a project picker and a secret-name picker (names only)', fakeAsync(() => {
    const { fixture, field, spec, options } = render(
      'BackupTarget',
      doc('BackupTarget', ['type: s3', 'endpoint: https://s3.example.com', 'bucket: b1']),
      [],
    );
    const project = field('credentials').querySelector('[data-testid="schema-ref-input"] input') as HTMLInputElement;

    project.dispatchEvent(new Event('focus'));
    fixture.detectChanges();
    http.expectOne(`${API}/access/me`).flush({ userId: 'u', clusterRole: null, projects: { ops: 'admin' } });
    http.expectOne(`${API}/resources?kind=Project&limit=20`).flush([res('Project', 'ops'), res('Project', 'web')]);
    fixture.detectChanges();
    expect(options().map(optionText)).toEqual(['ops Your role: admin', 'web Project']);

    options()[0].dispatchEvent(new MouseEvent('mousedown'));
    fixture.detectChanges();
    expect(spec()['credentials']).toBe('secret://ops/');

    const name = field('credentials').querySelector('[data-testid="schema-ref-secret-name"] input') as HTMLInputElement;

    name.value = 's3';
    name.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    // Typing writes at once (free text stays possible) …
    expect(spec()['credentials']).toBe('secret://ops/s3');
    tick(300);
    fixture.detectChanges();
    // … and the names of the chosen project are suggested (names only).
    const names = http.expectOne((req) => req.url === `${API}/projects/ops/secrets/names`);

    expect(names.request.params.get('q')).toBe('s3');
    names.flush({ items: [{ name: 's3-creds' }, { name: 's3-other' }] });
    fixture.detectChanges();

    const nameOptions = [
      ...field('credentials').ownerDocument.querySelectorAll('[data-testid="schema-ref-option"]'),
    ] as HTMLElement[];
    const creds = nameOptions.find((o) => o.textContent?.includes('s3-creds')) as HTMLElement;

    creds.dispatchEvent(new MouseEvent('mousedown'));
    fixture.detectChanges();
    expect(spec()['credentials']).toBe('secret://ops/s3-creds');
    expect(fixture.componentInstance.text()).toContain('credentials: secret://ops/s3-creds');
    discardPeriodicTasks();
  }));
});
