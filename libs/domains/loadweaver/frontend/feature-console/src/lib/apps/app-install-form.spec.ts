import {
  activeParameters,
  buildInstallRequest,
  initialParameterValues,
  installFormModel,
  missingSecrets,
  parameterIssues,
  secretNeeded,
  secretReference,
  suggestionItems,
  visibleSecrets,
} from './app-install-form';
import { testManifest } from './apps-testing';

describe('install form from the manifest (P1)', () => {
  const manifest = testManifest();
  const model = installFormModel(manifest);

  it('splits plain parameters from dependency toggles and connection parameters', () => {
    expect(model.parameters.map((p) => p.name)).toEqual(['domain', 'replicas']);
    expect(model.parameters[0]).toMatchObject({ required: true, schema: { title: 'Domain' } });
    expect(model.dependencies).toHaveLength(1);
    expect(model.dependencies[0]).toMatchObject({ toggle: 'bundledPostgres' });
    expect(model.dependencies[0].provided.map((p) => p.name)).toEqual(['postgresUrl']);
  });

  it('starts from the defaults (toggles bundled) and shows connection parameters only when provided', () => {
    const values = initialParameterValues(manifest);

    expect(values).toEqual({ replicas: 1, bundledPostgres: true });
    expect(activeParameters(model, values).map((p) => p.name)).toEqual(['domain', 'replicas', 'bundledPostgres']);
    expect(activeParameters(model, { ...values, bundledPostgres: false }).map((p) => p.name)).toEqual([
      'domain',
      'replicas',
      'bundledPostgres',
      'postgresUrl',
    ]);
  });

  it('checks active parameters against their JSON Schema (required only where active)', () => {
    const values = initialParameterValues(manifest);

    expect(parameterIssues(model, values)).toEqual([{ path: ['domain'], message: 'required' }]);
    expect(parameterIssues(model, { ...values, domain: 'a.example', replicas: 0 })).toEqual([
      expect.objectContaining({ path: ['replicas'] }),
    ]);
    expect(parameterIssues(model, { ...values, domain: 'a.example', bundledPostgres: false })).toEqual([
      { path: ['postgresUrl'], message: 'required' },
    ]);
    expect(parameterIssues(model, { ...values, domain: 'BAD' })).toEqual([
      expect.objectContaining({ path: ['domain'] }),
    ]);
  });

  it('lists secrets without a reference and builds references in the install project', () => {
    expect(missingSecrets(manifest, {})).toEqual(['admin-password']);
    expect(missingSecrets(manifest, { 'admin-password': 'pw' })).toEqual([]);
    expect(secretReference('shop', 'pw')).toBe('secret://shop/pw');
    expect(secretReference('shop', 'secret://ops/pw')).toBe('secret://ops/pw');
  });

  it('shows, requires and sends a conditional secret only while its condition holds', () => {
    const conditional = testManifest({
      parameters: {
        ...manifest.parameters,
        properties: {
          ...manifest.parameters.properties,
          payments: { type: 'boolean', default: false },
          auth: { type: 'string', enum: ['users', 'sso'], default: 'users' },
        },
      },
      secrets: [
        ...manifest.secrets,
        { name: 'payments-key', description: 'Key', requiredWhen: { parameter: 'payments' } },
        { name: 'sso-secret', description: 'Secret', requiredWhen: { parameter: 'auth', equals: 'sso' } },
      ],
    });
    const names = (values: Record<string, unknown>) => visibleSecrets(conditional, values).map((s) => s.name);

    expect(names({})).toEqual(['admin-password']);
    expect(names({ payments: true, auth: 'sso' })).toEqual(['admin-password', 'payments-key', 'sso-secret']);
    expect(secretNeeded(conditional, conditional.secrets[2], { auth: 'users' })).toBe(false);
    expect(missingSecrets(conditional, { 'admin-password': 'pw' })).toEqual([]);
    expect(missingSecrets(conditional, { 'admin-password': 'pw' }, { payments: true })).toEqual(['payments-key']);
    expect(
      buildInstallRequest({
        manifest: conditional,
        project: 'shop',
        name: 'agenstra',
        values: { domain: 'a.example', bundledPostgres: true, payments: false, auth: 'sso' },
        secrets: { 'admin-password': 'pw', 'payments-key': 'left-over', 'sso-secret': 'sso' },
        suggestions: [],
        selected: new Set(),
      }).secrets,
    ).toEqual({ 'admin-password': 'secret://shop/pw', 'sso-secret': 'secret://shop/sso' });
    // Picked while on, then switched back off (or left at its default): dropped from the request.
    expect(
      buildInstallRequest({
        manifest: conditional,
        project: 'shop',
        name: 'agenstra',
        values: { domain: 'a.example', bundledPostgres: true },
        secrets: { 'admin-password': 'pw', 'payments-key': 'picked', 'sso-secret': 'picked' },
        suggestions: [],
        selected: new Set(),
      }).secrets,
    ).toEqual({ 'admin-password': 'secret://shop/pw' });
  });

  it('builds the plan request: active parameters, secret references, the suggestion checklist', () => {
    const suggestions = suggestionItems(manifest);

    expect(suggestions.map((s) => [s.key, s.labels])).toEqual([
      ['policies', ['Policy agenstra-ingress']],
      ['dns', ['DnsRecord agenstra']],
      ['backups', ['daily']],
    ]);

    const request = buildInstallRequest({
      manifest,
      project: 'shop',
      name: 'agenstra',
      values: { domain: 'a.example', replicas: 2, bundledPostgres: true, postgresUrl: 'ignored-when-bundled' },
      secrets: { 'admin-password': 'admin-pw' },
      suggestions,
      selected: new Set(['dns', 'backups']),
    });

    expect(request).toEqual({
      project: 'shop',
      parameters: { domain: 'a.example', replicas: 2, bundledPostgres: true },
      secrets: { 'admin-password': 'secret://shop/admin-pw' },
      suggestions: ['dns', 'backups'],
    });

    expect(
      buildInstallRequest({
        manifest,
        project: 'shop',
        name: 'crm-2',
        values: { domain: 'a.example', bundledPostgres: false, postgresUrl: 'postgres://db' },
        secrets: {},
        suggestions: [],
        selected: new Set(),
      }),
    ).toEqual({
      project: 'shop',
      deployment: 'crm-2',
      parameters: { domain: 'a.example', bundledPostgres: false, postgresUrl: 'postgres://db' },
      secrets: {},
      suggestions: [],
    });
  });
});
