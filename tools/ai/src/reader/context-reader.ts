import * as fs from 'fs';
import * as path from 'path';

import type { AgenstraContext, AgenstraMetadata, RuleEntry, SkillEntry } from '../types';

const matter = require('gray-matter') as (input: string) => { data: Record<string, unknown>; content: string };

function readFileSafe(dir: string, file: string): string | null {
  const full = path.join(dir, file);

  try {
    return fs.readFileSync(full, 'utf-8');
  } catch {
    return null;
  }
}

function readJsonSafe<T>(dir: string, file: string): T | null {
  const content = readFileSafe(dir, file);

  if (content == null) return null;

  try {
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

/**
 * Parse an MDC file (YAML frontmatter + body) into metadata object and body string.
 */
function parseMdcSafe(dir: string, file: string): { data: Record<string, unknown>; content: string } | null {
  const raw = readFileSafe(dir, file);

  if (raw == null) return null;

  try {
    const parsed = matter(raw);
    const data = (parsed.data as Record<string, unknown>) ?? {};

    return { data, content: (parsed.content ?? '').trim() };
  } catch {
    return null;
  }
}

/**
 * Read .agenstra/ directory from the filesystem into an AgenstraContext.
 * @param agenstraDir - Absolute or relative path to the .agenstra directory
 */
export function readContext(agenstraDir: string): AgenstraContext {
  const root = path.isAbsolute(agenstraDir) ? agenstraDir : path.resolve(process.cwd(), agenstraDir);

  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`Not a directory: ${root}`);
  }

  const metadataRaw = readJsonSafe<Record<string, unknown>>(root, 'metadata.json');

  if (!metadataRaw || !metadataRaw.version || !metadataRaw.appName) {
    throw new Error(`${root}/metadata.json must exist and contain version and appName`);
  }

  const metadata: AgenstraMetadata = {
    appName: String(metadataRaw.appName),
  };
  const rules: Record<string, import('../types').RuleEntry> = {};
  const rulesDir = path.join(root, 'rules');

  if (fs.existsSync(rulesDir) && fs.statSync(rulesDir).isDirectory()) {
    for (const f of fs.readdirSync(rulesDir)) {
      if (f.endsWith('.mdc')) {
        const parsed = parseMdcSafe(rulesDir, f);

        if (parsed != null) {
          const key = f.replace(/\.mdc$/, '');
          const entry: RuleEntry = { content: parsed.content };

          if (parsed.data.id != null) entry.id = String(parsed.data.id);

          if (parsed.data.name != null) entry.name = String(parsed.data.name);

          if (parsed.data.description != null) entry.description = String(parsed.data.description);

          if (parsed.data.globs != null) {
            entry.globs = Array.isArray(parsed.data.globs)
              ? parsed.data.globs.map(String)
              : [String(parsed.data.globs)];
          }

          if (parsed.data.alwaysApply != null) entry.alwaysApply = Boolean(parsed.data.alwaysApply);

          if (entry.alwaysApply === true) entry.globs = ['**'];

          rules[key] = entry;
        }
      }
    }
  }

  const commands: Record<string, Record<string, unknown>> = {};
  const commandsDir = path.join(root, 'commands');

  if (fs.existsSync(commandsDir) && fs.statSync(commandsDir).isDirectory()) {
    for (const f of fs.readdirSync(commandsDir)) {
      if (f.endsWith('.command.mdc')) {
        const parsed = parseMdcSafe(commandsDir, f);

        if (parsed != null) {
          const key = f.replace(/\.command\.mdc$/, '');
          const d = parsed.data;
          const cmd: Record<string, unknown> = {
            id: (d.id as string) ?? key,
            name: d.name,
            description: d.description,
            prompt: parsed.content,
            agent: d.agent,
            model: d.model,
          };

          commands[key] = cmd;
        }
      }
    }
  }

  const skills: Record<string, SkillEntry> = {};
  const skillsDir = path.join(root, 'skills');

  if (fs.existsSync(skillsDir) && fs.statSync(skillsDir).isDirectory()) {
    for (const f of fs.readdirSync(skillsDir)) {
      if (f.endsWith('.skill.mdc')) {
        const parsed = parseMdcSafe(skillsDir, f);

        if (parsed != null) {
          const key = f.replace(/\.skill\.mdc$/, '');
          const entry: SkillEntry = { content: parsed.content };

          if (parsed.data.id != null) entry.id = String(parsed.data.id);

          if (parsed.data.name != null) entry.name = String(parsed.data.name);

          if (parsed.data.description != null) entry.description = String(parsed.data.description);

          skills[key] = entry;
        }
      }
    }
  }

  // Key by filename stem so architect.agent.mdc → architect
  const agents: Record<string, import('../types').AgenstraAgent> = {};
  const agentsDir = path.join(root, 'agents');

  if (fs.existsSync(agentsDir) && fs.statSync(agentsDir).isDirectory()) {
    for (const f of fs.readdirSync(agentsDir)) {
      if (f.endsWith('.agent.mdc')) {
        const parsed = parseMdcSafe(agentsDir, f);

        if (parsed != null) {
          const key = f.replace(/\.agent\.mdc$/, '');
          const d = parsed.data;
          const agent: import('../types').AgenstraAgent = {
            id: (d.id as string) ?? key,
            name: (d.name as string) ?? key,
            description: d.description != null ? String(d.description) : undefined,
            mode: (d.mode as 'primary') ?? 'primary',
            body: parsed.content || undefined,
            temperature: d.temperature != null ? Number(d.temperature) : undefined,
            model: d.model != null ? String(d.model) : undefined,
            tools:
              d.tools != null && typeof d.tools === 'object' && !Array.isArray(d.tools)
                ? (d.tools as Record<string, unknown>)
                : undefined,
          };

          agents[key] = agent;
        }
      }
    }
  }

  const subagents: Record<string, import('../types').AgenstraSubagent> = {};
  const subagentsDir = path.join(root, 'subagents');

  if (fs.existsSync(subagentsDir) && fs.statSync(subagentsDir).isDirectory()) {
    for (const f of fs.readdirSync(subagentsDir)) {
      if (f.endsWith('.subagent.mdc')) {
        const parsed = parseMdcSafe(subagentsDir, f);

        if (parsed != null) {
          const key = f.replace(/\.subagent\.mdc$/, '');
          const d = parsed.data;
          const subagent: import('../types').AgenstraSubagent = {
            id: (d.id as string) ?? key,
            name: (d.name as string) ?? key,
            description: d.description != null ? String(d.description) : undefined,
            mode: (d.mode as 'subagent') ?? 'subagent',
            body: parsed.content || undefined,
            temperature: d.temperature != null ? Number(d.temperature) : undefined,
            model: d.model != null ? String(d.model) : undefined,
            tools:
              d.tools != null && typeof d.tools === 'object' && !Array.isArray(d.tools)
                ? (d.tools as Record<string, unknown>)
                : undefined,
          };

          subagents[key] = subagent;
        }
      }
    }
  }

  const mcpDefinitions: Record<string, Record<string, unknown>> = {};
  const mcpDir = path.join(root, 'mcp-definitions');

  if (fs.existsSync(mcpDir) && fs.statSync(mcpDir).isDirectory()) {
    for (const f of fs.readdirSync(mcpDir)) {
      if (f.endsWith('.mcp.json')) {
        const raw = readJsonSafe<Record<string, unknown>>(mcpDir, f);

        if (raw != null) {
          const id = (raw.id as string) ?? f.replace(/\.mcp\.json$/, '');
          const def: Record<string, unknown> = {
            id,
            name: raw.name,
            description: raw.description,
            type: raw.type,
            command: raw.command,
            args: raw.args,
            environment: raw.environment,
            env: raw.env,
            url: raw.url,
            headers: raw.headers,
            enabled: raw.enabled,
          };

          mcpDefinitions[id] = def;
        }
      }
    }
  }

  return {
    metadata,
    rules,
    commands,
    skills,
    agents,
    subagents,
    mcpDefinitions,
  };
}
