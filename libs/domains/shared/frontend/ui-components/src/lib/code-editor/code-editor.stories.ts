import type { Meta, StoryObj } from '@storybook/angular';
import { applicationConfig, moduleMetadata } from '@storybook/angular';
import { provideMonacoEditor } from 'ngx-monaco-editor-v2';

import { FpcCodeEditorComponent } from './code-editor.component';
import { type FpcDocumentIssue, fpcJsonValidator, fpcYamlValidator } from './code-editor.validators';

const MANIFEST = `# Loadweaver service manifest
name: shop
services:
  web:
    image: ghcr.io/example/shop:1.4.2
    replicas: 3
    ports:
      - 8080
  worker:
    image: ghcr.io/example/shop-worker:1.4.2
    replicas: "two"
`;

/** Example structural check, as a consumer would derive it from a JSON Schema. */
function checkManifest(document: unknown): FpcDocumentIssue[] {
  const issues: FpcDocumentIssue[] = [];
  const manifest = (document ?? {}) as { name?: unknown; services?: Record<string, Record<string, unknown>> };

  if (typeof manifest.name !== 'string') {
    issues.push({ path: ['name'], message: 'is required and must be a string' });
  }

  for (const [service, spec] of Object.entries(manifest.services ?? {})) {
    if (typeof spec?.['image'] !== 'string') {
      issues.push({ path: ['services', service], message: 'image is required' });
    }

    if (spec?.['replicas'] !== undefined && !Number.isInteger(spec['replicas'])) {
      issues.push({ path: ['services', service, 'replicas'], message: 'must be an integer' });
    }
  }

  return issues;
}

const meta: Meta<FpcCodeEditorComponent> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Editing manifests, cloud-init and other YAML / JSON config with syntax highlighting and inline validation.

**When not to:** Single-line values: use \`fpc-form-control\`. Terminal output: use \`fpc-terminal\`.

Monaco via \`ngx-monaco-editor-v2\`. **Setup:** register the loader once in the consuming app or route, e.g. \`providers: [provideMonacoEditor()]\`, and serve Monaco's AMD build at \`assets/monaco/min/vs\` (copy \`node_modules/monaco-editor/min\`) or pass \`provideMonacoEditor({ baseUrl })\`. This Storybook serves it from \`node_modules\`.

**Validation:** pass \`validate\` (a function returning \`{ line, column, message, severity }[]\`). \`fpcYamlValidator(checkDocument?)\` and \`fpcJsonValidator(checkDocument?)\` report syntax errors and map \`{ path, message }\` issues of your document check (e.g. derived from a JSON Schema) to the right line. Diagnostics become editor markers and are emitted via \`(diagnosticsChange)\`.

The theme is derived from the brand variables and follows **Theme** / **Color set**.`,
      },
    },
  },

  title: 'Forms/Code Editor',
  component: FpcCodeEditorComponent,
  decorators: [
    applicationConfig({ providers: [provideMonacoEditor({ baseUrl: './assets/monaco/min/vs' })] }),
    moduleMetadata({ imports: [FpcCodeEditorComponent] }),
  ],
  argTypes: {
    language: { control: 'select', options: ['yaml', 'json', 'shell', 'ini', 'dockerfile', 'plaintext'] },
    valueChange: { action: 'valueChange' },
    diagnosticsChange: { action: 'diagnosticsChange' },
  },
  args: {
    value: MANIFEST,
    language: 'yaml',
    readOnly: false,
    height: '20rem',
    fontSize: 13,
    validate: fpcYamlValidator(checkManifest),
  },
  render: (args) => ({
    props: args,
    template: `<fpc-code-editor
            [value]="value"
            [language]="language"
            [readOnly]="readOnly"
            [height]="height"
            [fontSize]="fontSize"
            [validate]="validate"
            (valueChange)="valueChange($event)"
            (diagnosticsChange)="diagnosticsChange($event)"
        />`,
  }),
};

export default meta;

type Story = StoryObj<FpcCodeEditorComponent>;

export const YamlWithValidation: Story = {};

export const Json: Story = {
  args: {
    language: 'json',
    value: JSON.stringify({ name: 'shop', spec: { port: 70000 } }, null, 2),
    validate: fpcJsonValidator((document) => {
      const port = (document as { spec?: { port?: number } })?.spec?.port;

      return port !== undefined && (port < 1 || port > 65535)
        ? [{ path: ['spec', 'port'], message: 'must be 1-65535' }]
        : [];
    }),
  },
};

export const ReadOnly: Story = { args: { readOnly: true, validate: null } };
