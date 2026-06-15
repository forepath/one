# Agenstra AI Context

This directory (`.agenstra/`) is the single source of truth for AI coding assistant context. It uses a tool-agnostic schema that can be transformed into configs for Cursor, OpenCode, GitHub Copilot, and others.

## Structure

- **metadata.json** – Project metadata (required: `version`, `appName`; optional: `description`)
- **rules/** – Instruction-based rules (`.mdc`)
- **commands/** – Reusable command definitions (`.command.mdc`)
- **skills/** – Reusable skill documentation (`.skill.mdc`)
- **agents/** – Primary agent configs (`.agent.mdc`: YAML frontmatter + body)
- **subagents/** – Subagent configs (`.subagent.mdc`: YAML frontmatter + body)
- **mcp-definitions/** – MCP (Model Context Protocol) server definitions (JSON)
- **overrides/** – Manual overrides (copied last, can overwrite generated content)

## Usage

This folder is the **example context** for the repo. The `@forepath/ai` tool acts as a **transformer** from `.agenstra/` to tool-specific configs (e.g. `.cursor/`, OpenCode, GitHub Copilot). Run the transformer when implemented (e.g. `agenstra transform --path=.agenstra --target=cursor`). Do not remove or overwrite existing `.cursor` contents when copying context manually.

**Overrides**: Files in `overrides/` are copied to the output directory after transformation, allowing you to manually override or extend generated content. The override structure mirrors the output structure (e.g., `overrides/.cursor/...` → `generated/.cursor/...`).
