import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({
  name: 'devkit',
  version: '1.0.0',
});

async function readDevkitPackageName(devkitRoot: string): Promise<string> {
  try {
    const pkgJsonRaw = await fs.readFile(path.join(devkitRoot, 'package.json'), 'utf-8');
    const pkgJson = JSON.parse(pkgJsonRaw) as { name?: string };

    return pkgJson.name ?? '@forepath/code';
  } catch {
    return '@forepath/code';
  }
}

async function readGeneratorsIndex(devkitRoot: string) {
  const generatorsJsonPath = path.join(devkitRoot, 'generators.json');
  const raw = await fs.readFile(generatorsJsonPath, 'utf-8');

  return JSON.parse(raw) as {
    generators: Record<string, { factory: string; schema: string; description?: string }>;
  };
}

async function readGeneratorSchema(devkitRoot: string, schemaRelPath: string) {
  const schemaPath = path.resolve(devkitRoot, schemaRelPath);
  const schemaRaw = await fs.readFile(schemaPath, 'utf-8');

  return { schemaPath, schema: JSON.parse(schemaRaw) } as {
    schemaPath: string;
    schema: any;
  };
}

type GeneratorOption = {
  name: string;
  type: string | undefined;
  description?: string;
  enum?: any[] | undefined;
  default?: any;
  required: boolean;
};

function buildOptionsFromSchema(schema: any): GeneratorOption[] {
  const properties = schema?.properties ?? {};
  const required: string[] = Array.isArray(schema?.required) ? schema.required : [];

  return Object.entries(properties).map(([optionName, optionSchema]: [string, any]) => ({
    name: optionName,
    type: optionSchema?.type,
    description: optionSchema?.description,
    enum: optionSchema?.enum,
    default: optionSchema?.default,
    required: required.includes(optionName),
  }));
}

function placeholderForOption(opt: GeneratorOption): string {
  if (opt.enum && Array.isArray(opt.enum) && opt.enum.length > 0) {
    return `<${opt.enum.join('|')}>`;
  }

  if (opt.type) {
    return `<${opt.type}>`;
  }

  return `<value>`;
}

function buildSignature(packageName: string, generatorName: string, options: GeneratorOption[]): string {
  const requiredParts: string[] = [];
  const optionalParts: string[] = [];

  for (const o of options) {
    const isBoolean = o.type === 'boolean' && !o.enum;
    const segment = isBoolean ? `--${o.name}` : `--${o.name} ${placeholderForOption(o)}`;

    if (o.required) requiredParts.push(segment);
    else optionalParts.push(segment);
  }

  const requiredSig = requiredParts.join(' ');
  const optionalSig = optionalParts.length > 0 ? ' ' + optionalParts.map((s) => ` [${s}]`).join('') : '';

  return `nx g ${packageName}:${generatorName}${requiredSig ? ' ' + requiredSig : ''}${optionalSig}`;
}

server.tool('devkit_list_generators', 'List all available custom Nx generators', async () => {
  const workspaceRoot = process.cwd();
  const devkitRoot = path.resolve(workspaceRoot, 'tools', 'devkit');

  try {
    const packageName = await readDevkitPackageName(devkitRoot);
    const parsed = await readGeneratorsIndex(devkitRoot);
    const entries = await Promise.all(
      Object.entries(parsed.generators).map(async ([generatorName, meta]) => {
        const { schemaPath, schema } = await readGeneratorSchema(devkitRoot, meta.schema);
        const options = buildOptionsFromSchema(schema);
        const signature = buildSignature(packageName, generatorName, options);

        return {
          name: generatorName,
          description: meta.description ?? schema?.description ?? '',
          displayName: schema?.title ?? generatorName,
          displayDescription: schema?.description ?? meta.description ?? '',
          factory: meta.factory,
          schemaPath,
          options,
          command: {
            package: packageName,
            generator: generatorName,
            signature,
          },
        };
      }),
    );

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ package: packageName, generators: entries }, null, 2),
        },
      ],
    };
  } catch (error: any) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ error: String(error?.message ?? error) }),
        },
      ],
    };
  }
});

server.tool(
  'devkit_get_generator',
  'Get detailed info for a single custom Nx generator',
  { name: z.string() },
  async (args) => {
    const workspaceRoot = process.cwd();
    const devkitRoot = path.resolve(workspaceRoot, 'tools', 'devkit');
    const generatorName = String(args?.name ?? '');

    try {
      const packageName = await readDevkitPackageName(devkitRoot);
      const parsed = await readGeneratorsIndex(devkitRoot);
      const meta = parsed.generators[generatorName];

      if (!meta) {
        throw new Error(`Generator not found: ${generatorName}`);
      }

      const { schemaPath, schema } = await readGeneratorSchema(devkitRoot, meta.schema);
      const options = buildOptionsFromSchema(schema);
      const signature = buildSignature(packageName, generatorName, options);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                name: generatorName,
                description: meta.description ?? schema?.description ?? '',
                displayName: schema?.title ?? generatorName,
                displayDescription: schema?.description ?? meta.description ?? '',
                factory: meta.factory,
                schemaPath,
                options,
                command: {
                  package: packageName,
                  generator: generatorName,
                  signature,
                },
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: String(error?.message ?? error) }),
          },
        ],
      };
    }
  },
);

server.tool(
  'devkit_validate_generator',
  'Validate options for a custom Nx generator and preview command',
  { name: z.string(), options: z.record(z.string(), z.any()).default({}) },
  async (args) => {
    const workspaceRoot = process.cwd();
    const devkitRoot = path.resolve(workspaceRoot, 'tools', 'devkit');
    const generatorName = String(args?.name ?? '');
    const inputOptions = (args?.options as Record<string, any>) ?? {};

    try {
      const packageName = await readDevkitPackageName(devkitRoot);
      const parsed = await readGeneratorsIndex(devkitRoot);
      const meta = parsed.generators[generatorName];

      if (!meta) {
        throw new Error(`Generator not found: ${generatorName}`);
      }

      const { schema } = await readGeneratorSchema(devkitRoot, meta.schema);
      const options = buildOptionsFromSchema(schema);
      const errors: string[] = [];
      const byName = new Map(options.map((o) => [o.name, o] as const));

      for (const o of options) {
        if (o.required && (inputOptions[o.name] === undefined || inputOptions[o.name] === null)) {
          errors.push(`Missing required option --${o.name}`);
        }
      }

      for (const [key, value] of Object.entries(inputOptions)) {
        const spec = byName.get(key);

        if (!spec) continue;

        if (spec.enum && Array.isArray(spec.enum) && !spec.enum.includes(value)) {
          errors.push(`Invalid value for --${key}. Expected one of: ${spec.enum.join(', ')}`);
          continue;
        }

        if (spec.type) {
          const t = typeof value;

          if (spec.type === 'number' && t !== 'number') errors.push(`--${key} must be a number`);

          if (spec.type === 'string' && t !== 'string') errors.push(`--${key} must be a string`);

          if (spec.type === 'boolean' && t !== 'boolean') errors.push(`--${key} must be a boolean`);
        }
      }

      const parts: string[] = [`nx`, `g`, `${packageName}:${generatorName}`];

      for (const o of options) {
        if (!(o.name in inputOptions)) continue;

        const v = inputOptions[o.name];
        const isBoolean = o.type === 'boolean' && !o.enum;

        if (isBoolean) {
          if (v === true) parts.push(`--${o.name}`);

          continue;
        }

        parts.push(`--${o.name}`);
        parts.push(String(v));
      }

      const command = parts.join(' ');
      const signature = buildSignature(packageName, generatorName, options);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ok: errors.length === 0,
                errors,
                signature,
                preview: command,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: String(error?.message ?? error) }),
          },
        ],
      };
    }
  },
);

server.tool('devkit_list_docs', 'List Markdown docs under the docs/ directory with metadata', async () => {
  const workspaceRoot = process.cwd();
  const docsRoot = path.resolve(workspaceRoot, 'docs');

  async function pathExists(p: string) {
    try {
      await fs.access(p);

      return true;
    } catch {
      return false;
    }
  }

  async function walk(dir: string): Promise<string[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const results: string[] = [];

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        results.push(...(await walk(fullPath)));
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        results.push(fullPath);
      }
    }

    return results;
  }

  function extractTitle(markdown: string, fallback: string) {
    const match = markdown.match(/^#\s+(.+)$/m);

    return match?.[1]?.trim() ?? fallback;
  }

  function extractHeadings(markdown: string) {
    const lines = markdown.split(/\r?\n/);
    const headings: { level: number; text: string }[] = [];

    for (const line of lines) {
      const h2 = line.match(/^##\s+(.+)/);

      if (h2) headings.push({ level: 2, text: h2[1].trim() });

      const h3 = line.match(/^###\s+(.+)/);

      if (h3) headings.push({ level: 3, text: h3[1].trim() });
    }

    return headings;
  }

  function extractSummary(markdown: string) {
    const withoutFrontmatter = markdown.replace(/^---[\s\S]*?---\s*/m, '');
    const parts = withoutFrontmatter.split(/\n\n+/).map((s) => s.trim());
    const firstPara = parts.find((p) => p && !p.startsWith('#'));

    return firstPara ?? '';
  }

  try {
    if (!(await pathExists(docsRoot))) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ docs: [] }, null, 2) }],
      };
    }

    const files = await walk(docsRoot);
    const docs = await Promise.all(
      files.map(async (absPath) => {
        const relPath = path.relative(docsRoot, absPath);
        const content = await fs.readFile(absPath, 'utf-8');
        const title = extractTitle(content, path.basename(relPath, '.md'));
        const headings = extractHeadings(content);
        const summary = extractSummary(content);
        const stat = await fs.stat(absPath);

        return {
          path: relPath,
          title,
          headings,
          summary,
          lastModified: stat.mtime.toISOString(),
        };
      }),
    );

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ root: 'docs', docs }, null, 2),
        },
      ],
    };
  } catch (error: any) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ error: String(error?.message ?? error) }),
        },
      ],
    };
  }
});

server.tool('devkit_get_doc', 'Get a Markdown doc from docs/ by relative path', { path: z.string() }, async (args) => {
  const rel = String(args?.path ?? '');
  const workspaceRoot = process.cwd();
  const docsRoot = path.resolve(workspaceRoot, 'docs');
  const absPath = path.resolve(docsRoot, rel);

  function extractTitle(markdown: string, fallback: string) {
    const match = markdown.match(/^#\s+(.+)$/m);

    return match?.[1]?.trim() ?? fallback;
  }

  function extractHeadings(markdown: string) {
    const lines = markdown.split(/\r?\n/);
    const headings: { level: number; text: string }[] = [];

    for (const line of lines) {
      const h2 = line.match(/^##\s+(.+)/);

      if (h2) headings.push({ level: 2, text: h2[1].trim() });

      const h3 = line.match(/^###\s+(.+)/);

      if (h3) headings.push({ level: 3, text: h3[1].trim() });

      const h4 = line.match(/^####\s+(.+)/);

      if (h4) headings.push({ level: 4, text: h4[1].trim() });

      const h5 = line.match(/^#####\s+(.+)/);

      if (h5) headings.push({ level: 5, text: h5[1].trim() });

      const h6 = line.match(/^######\s+(.+)/);

      if (h6) headings.push({ level: 6, text: h6[1].trim() });
    }

    return headings;
  }

  try {
    if (!absPath.startsWith(docsRoot)) {
      throw new Error('Path escapes docs root');
    }

    const content = await fs.readFile(absPath, 'utf-8');
    const title = extractTitle(content, path.basename(absPath, '.md'));
    const headings = extractHeadings(content);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ path: rel, title, headings, content }, null, 2),
        },
      ],
    };
  } catch (error: any) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ error: String(error?.message ?? error) }),
        },
      ],
    };
  }
});

const transport = new StdioServerTransport();

(async () => {
  await server.connect(transport);
})();
