# Knowledge Graph

The monorepo knowledge graph helps humans and AI agents understand structure without repeatedly scanning every source file.

## Why it exists

Large Nx workspaces span many apps and libs. The graph unifies:

- Nx **project** dependencies (`app` / `lib` / `tool`)
- Production **npm packages** attributed per app via Nx `createPackageJson` (SBOM-equivalent)
- **patch-package** files under `patches/` when they target an attributed package
- **OpenAPI** / **AsyncAPI** operations and channels
- **Markdown** concepts under `docs/<domain>/`
- Heuristic **implements** links from Nest controllers to OpenAPI paths and gateways to AsyncAPI channels
- Architectural sources: controllers, gateways, jobs, services, repositories, entities, DTOs, guards, modules, domain providers, accumulated NgRx `state` slices, email templates, and webhook events

Artifacts live at:

| File               | Purpose                                             |
| ------------------ | --------------------------------------------------- |
| `graph/graph.json` | Machine-readable nodes and edges                    |
| `graph/graph.html` | Local debugger UI (serve with `nx run graph:serve`) |

## How to generate

From the workspace root:

```bash
nx run graph:generate-kg
```

This builds `@forepath/graph` (if needed) and writes `graph/graph.json` and `graph/graph.html`.

Also available as:

```bash
nx generate @forepath/graph:generate-kg
```

### View in the browser

```bash
nx run graph:serve
```

Opens a static server on [http://127.0.0.1:4211/](http://127.0.0.1:4211/) (serves the `graph/` directory). Use `--port` / `--dir` after `--` if needed.

### Pre-commit

The Husky `pre-commit` hook regenerates the graph on every commit and stages the artifacts:

```bash
nx run graph:generate-kg
git add graph/graph.json graph/graph.html
```

Committed graph files are therefore kept current without a separate manual step.

## Schema overview

- **Nodes:** `app`, `lib`, `tool`, `package`, `patch`, `domain`, `context`, `feature-group`, `controller`, `gateway`, `job`, `service`, `repository`, `entity`, `dto`, `guard`, `module`, `state`, `provider`, `email`, `webhook-event`, `doc`, `readme`, `openapi`, `asyncapi`, `diagram`, `endpoint`, `concept`
- **Edges:** `depends_on`, `contains`, `implements`, `documents`, `belongs_to`

See the **Knowledge Graph Skill** for id patterns and traversal recipes.

## Using the graph with AI tools

1. Load the **Knowledge Graph Skill**.
2. Prefer the **knowledge-graph MCP** (`.agenstra/mcp-definitions/knowledge-graph.mcp.json` → Cursor `.cursor/mcp.json`) — tools `graph_r1`, `graph_docs`, `graph_endpoint`, `graph_search`, `graph_impact`, `graph_mentions`.
3. Or use the CLI: `nx run graph:query -- r1 <project>`, `nx run graph:impact -- --base main`, `nx run graph:query -- mentions <project>`.
4. Do **not** paste all of `graph/graph.json` into context; recipe tools return compact neighborhoods.
5. Optionally open `graph/graph.html` via `nx run graph:serve` for visual inspection.
6. Fall back to source under each project's `root` when edges are missing.
7. Use `graph_mentions` when you need textual consumers that are not declared Nx `depends_on` edges.

Build the MCP/CLI entrypoints after graph tool changes (or let the launcher build on first start):

```bash
nx run graph:build
# or: node tools/graph/mcp-run.cjs  # builds dist if missing, then starts MCP
```

## Security

The generator indexes **paths and API metadata only**. It skips sensitive path names (for example `.env*`, `*secret*`, `*credential*`) and does not embed environment values, tokens, or encrypted secrets into `graph.json`.

`__fixtures__`, `.angular`, and `.cache` directories are skipped during discovery so test sandboxes and build caches do not pollute blast-radius results. `graph_mentions` also omits bare tokens shorter than 8 characters and ignores cache/fixture hit paths.

## Implementation

Plugin package: `tools/graph` (`@forepath/graph`), sublicensed under AGPL-3.0.
