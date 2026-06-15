# AgentCTX

**AgentCTX (Agent Context)** is the command-line binary that generates tool-specific agent config from a `.agenstra/` context. It is built from the `@forepath/ai` package in `tools/ai` and provides the same transformation logic as the [Nx executor](./README.md#generating-tool-configs) and the programmatic API described in `tools/ai/README.md` in the repository—useful when you want to run the transform without Nx or from a standalone install.

## Purpose

- **Validate** – Check that a directory contains a valid `.agenstra/` context (e.g. `metadata.json` and expected structure).
- **Transform** – Read `.agenstra/` and emit config for one or more tools (Cursor, OpenCode, GitHub Copilot) into an output directory.

agentctx does **not** scaffold or create `.agenstra/`; use the example in this repo’s `.agenstra/` as reference.

## Installation

### From source (monorepo)

Build the binary from the `tools/ai` package:

```bash
nx run ai:scripts-binary
```

The binary is written to `dist/tools/ai/bin/agentctx`. To run it from the repo root:

```bash
./dist/tools/ai/bin/agentctx --help
```

Or add `dist/tools/ai/bin` to your `PATH`, or symlink:

```bash
ln -sf "$(pwd)/dist/tools/ai/bin/agentctx" /usr/local/bin/agentctx
```

### Install script (Linux and macOS)

The `tools/ai/install.sh` script installs the **agentctx** binary to `/usr/bin/agentctx`. It supports common Linux distros and macOS.

**Requirements**: Node.js (required to run the binary), and `curl` or `wget` (to download the binary when not installing from a local file).

**One-liner** (download and run; requires sudo):

```bash
curl -fsSL https://downloads.agenstra.com/agentctx/install.sh | bash
```

To use a custom binary download URL:

```bash
AGENTCTX_INSTALL_URL=https://example.com/agentctx curl -fsSL https://downloads.agenstra.com/agentctx/install.sh | bash
```

The install script will attempt to install Node.js and curl if they are missing (via the system package manager). On unsupported systems, install [Node.js](https://nodejs.org/) and curl/wget manually, then run the script again.

## Usage

```text
agentctx [options]
```

### Options

| Option              | Short | Description                                                                          |
| ------------------- | ----- | ------------------------------------------------------------------------------------ |
| `--path <dir>`      | `-p`  | Directory that contains `.agenstra/` (default: `.`)                                  |
| `--target <list>`   | `-t`  | Comma-separated targets: `cursor`, `opencode`, `github-copilot` (default: all three) |
| `--outputDir <dir>` | `-o`  | Base output directory for generated configs (default: `.`)                           |
| `--dry-run`         | -     | Only validate that `.agenstra/` exists; do not write files                           |
| `--help`            | `-h`  | Show help and exit                                                                   |

### Prerequisites

- The path (default: current directory) must contain a `.agenstra/` directory with a valid `metadata.json`. If not, agentctx exits with an error and does not transform.

### Examples

Run with no arguments: look for `.agenstra/` in the current directory and write `.cursor/`, `.opencode/`, `.github/` (and OpenCode root files) into that same folder:

```bash
agentctx
```

Use a specific project root; output is written there as well (default `--outputDir .` is resolved relative to `--path`):

```bash
agentctx --path /path/to/my-app
```

Write to a different directory (e.g. a staging folder):

```bash
agentctx --outputDir generated
agentctx --path /path/to/my-app --outputDir dist/agent-config
```

Generate only Cursor and OpenCode config:

```bash
agentctx --target cursor,opencode
```

Validate that `.agenstra/` is present without writing any files:

```bash
agentctx --dry-run
```

Show help:

```bash
agentctx --help
```

### Output

When run without `--dry-run`, agentctx writes tool-specific output under `<outputDir>/` using the standard directory names for each tool:

- `<outputDir>/.cursor/` – Cursor rules, commands, skills, agents, `mcp.json`
- `<outputDir>/.opencode/` – OpenCode commands, agents; plus `AGENTS.md` and `opencode.json` at the output root
- `<outputDir>/.github/` – GitHub Copilot instructions

With the default `--outputDir .`, running `agentctx` in your project root writes `.cursor/`, `.opencode/`, `.github/`, etc. directly into that folder. If you use a different output directory (e.g. `--outputDir generated`), copy or symlink the generated content into your project root as needed. After transformation, files from `.agenstra/overrides/` are copied on top, so overrides can overwrite or extend generated content.

On success, agentctx prints one line per target and exits with code 0. On validation or transform errors, it prints errors to stderr and exits with code 1.

## Related

- [README](./README.md) – Overview of `.agenstra/` and generating tool configs
- [Rules](./rules.md) – Project instructions in `.agenstra/rules/`
- [Commands](./commands.md) – Slash-style commands in `.agenstra/commands/`
- [Agents](./agents.md) – Agents and subagents in `.agenstra/agents/` and `subagents/`
