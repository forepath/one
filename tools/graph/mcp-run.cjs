#!/usr/bin/env node
/**
 * MCP entry that ensures dist/tools/graph/src/mcp.js exists before starting.
 * Safe to point Cursor/OpenCode at this file even on a clean checkout.
 *
 * Stdout is reserved for MCP JSON-RPC — build/logs go to stderr only.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function findWorkspaceRoot(startDir) {
  let dir = path.resolve(startDir);
  for (;;) {
    if (
      fs.existsSync(path.join(dir, 'nx.json')) ||
      fs.existsSync(path.join(dir, 'graph', 'graph.json'))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return path.resolve(startDir);
    }
    dir = parent;
  }
}

function mcpEntry(root) {
  return path.join(root, 'dist', 'tools', 'graph', 'src', 'mcp.js');
}

function ensureBuilt(root) {
  const entry = mcpEntry(root);
  if (fs.existsSync(entry)) {
    return entry;
  }

  process.stderr.write(
    '[forepath/graph-mcp] dist missing; running nx run graph:build…\n',
  );
  const result = spawnSync('npx', ['nx', 'run', 'graph:build'], {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
    // Keep MCP stdout clean
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.stdout) {
    process.stderr.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  if (result.status !== 0 || !fs.existsSync(entry)) {
    process.stderr.write(
      '[forepath/graph-mcp] Build failed; cannot start MCP server.\n',
    );
    process.exit(result.status ?? 1);
  }

  process.stderr.write(
    '[forepath/graph-mcp] Build complete; starting server.\n',
  );
  return entry;
}

const workspaceRoot =
  process.env.CURSOR_WORKSPACE ||
  process.env.WORKSPACE_FOLDER ||
  findWorkspaceRoot(process.cwd());

const entry = ensureBuilt(workspaceRoot);
require(entry);
