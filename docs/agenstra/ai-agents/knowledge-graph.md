# Knowledge Graph

The monorepo knowledge graph helps humans and AI agents understand structure without repeatedly scanning every source file.

## Why it exists

Large Nx workspaces span many apps and libs. The graph unifies:

- Nx **project** dependencies
- **OpenAPI** / **AsyncAPI** operations and channels
- **Markdown** concepts under `docs/<domain>/`
- Heuristic **implements** links from Nest controllers to OpenAPI paths

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

- **Nodes:** `app`, `lib`, `domain`, `context`, `feature-group`, `file`, `doc`, `readme`, `openapi`, `asyncapi`, `diagram`, `endpoint`, `concept`
- **Edges:** `depends_on`, `contains`, `implements`, `documents`, `belongs_to`

See the **Knowledge Graph Skill** for id patterns and traversal recipes.

## Using the graph with AI tools

1. Load the **Knowledge Graph Skill**.
2. Read `graph/graph.json` (prefer targeted searches by node `id` or `type`).
3. Optionally open `graph/graph.html` in a browser for neighborhood inspection.
4. Fall back to source under each project's `root` when edges are missing.

## Security

The generator indexes **paths and API metadata only**. It skips sensitive path names (for example `.env*`, `*secret*`, `*credential*`) and does not embed environment values, tokens, or encrypted secrets into `graph.json`.

## Implementation

Plugin package: `tools/graph` (`@forepath/graph`), sublicensed under AGPL-3.0.
