import * as path from 'path';

import type { ProjectGraph } from '@nx/devkit';

import { discoverFiles } from './discover-files';
import { discoverPatches } from './discover-patches';
import { discoverToolDirectories } from './discover-tools';
import { buildClusterSlice } from './build-clusters';
import { fromProjectGraph } from './from-project-graph';
import { linkDocuments } from './link-documents';
import { linkImplements } from './link-implements';
import { INJECTOR_SOURCE_TYPES, linkInjects } from './link-injects';
import { linkHttpCalls, linkStateFacadeInjects } from './link-http-calls';
import { linkModuleProvides } from './link-module-provides';
import { linkPackages } from './link-packages';
import { linkToolUsage } from './link-tool-usage';
import { linkStateServices } from './link-state-services';
import { parseAsyncApiFile } from './parse-asyncapi';
import { parseMarkdownFile } from './parse-markdown';
import { parseOpenApiFile } from './parse-openapi';
import { parseWebhookEventsCatalogFile } from './parse-webhook-events';
import {
  fileNodeId,
  fileNodeTypeFromKind,
  KnowledgeEdge,
  KnowledgeGraph,
  KnowledgeNode,
  ProjectNodeAttrs,
} from './schema';
import { writeGraphJsonAtomic } from './write-graph';
import { writeGraphHtml } from './write-html';

export interface BuildKnowledgeGraphOptions {
  projectGraph: ProjectGraph;
  workspaceRoot: string;
  /** Override generatedAt for tests */
  generatedAt?: string;
}

/**
 * Build the unified knowledge graph from Nx project graph, specs, and docs.
 */
export function buildKnowledgeGraph(options: BuildKnowledgeGraphOptions): KnowledgeGraph {
  const { projectGraph, workspaceRoot } = options;
  const nodesById = new Map<string, KnowledgeNode>();
  const edges: KnowledgeEdge[] = [];
  const edgeKeys = new Set<string>();

  const addNode = (node: KnowledgeNode): void => {
    if (!nodesById.has(node.id)) {
      nodesById.set(node.id, node);
    }
  };

  const addEdge = (edge: KnowledgeEdge): void => {
    const key = `${edge.type}|${edge.from}|${edge.to}`;
    if (edgeKeys.has(key)) {
      return;
    }
    edgeKeys.add(key);
    edges.push(edge);
  };

  const projectSlice = fromProjectGraph(projectGraph);
  for (const node of projectSlice.nodes) {
    addNode(node);
  }
  for (const edge of projectSlice.edges) {
    addEdge(edge);
  }

  const toolDirs = discoverToolDirectories(workspaceRoot, projectGraph);
  for (const node of toolDirs.nodes) {
    addNode(node);
  }

  const packageSlice = linkPackages({ projectGraph, workspaceRoot });
  for (const node of packageSlice.nodes) {
    addNode(node);
  }
  for (const edge of packageSlice.edges) {
    addEdge(edge);
  }

  const toolUsage = linkToolUsage({ projectGraph, workspaceRoot });
  for (const edge of toolUsage.edges) {
    addEdge(edge);
  }

  const patchSlice = discoverPatches(workspaceRoot, [...nodesById.values()]);
  for (const node of patchSlice.nodes) {
    addNode(node);
  }
  for (const edge of patchSlice.edges) {
    addEdge(edge);
  }

  const discovered = discoverFiles(workspaceRoot, projectGraph);
  for (const node of discovered.nodes) {
    addNode(node);
  }
  for (const edge of discovered.edges) {
    addEdge(edge);
  }

  // Docs files are not owned by projects; ensure file nodes exist (discover already adds them)
  const conceptTexts = new Map<string, string>();

  for (const file of discovered.files) {
    if (file.webhookEventsCatalog) {
      const parsed = parseWebhookEventsCatalogFile(file.relativePath, file.absolutePath, file.projectName);
      for (const node of parsed.nodes) {
        addNode(node);
      }
      for (const edge of parsed.edges) {
        addEdge(edge);
      }
      continue;
    }
    if (file.languageOrKind === 'openapi') {
      const parsed = parseOpenApiFile(file.relativePath, file.absolutePath);
      for (const node of parsed.nodes) {
        addNode(node);
      }
      for (const edge of parsed.edges) {
        addEdge(edge);
      }
    } else if (file.languageOrKind === 'asyncapi') {
      const parsed = parseAsyncApiFile(file.relativePath, file.absolutePath);
      for (const node of parsed.nodes) {
        addNode(node);
      }
      for (const edge of parsed.edges) {
        addEdge(edge);
      }
    } else if (file.languageOrKind === 'md') {
      const mdType = fileNodeTypeFromKind('md', file.relativePath);
      addNode({
        id: fileNodeId(file.relativePath),
        type: mdType,
        attrs: {
          path: file.relativePath,
          languageOrKind: 'md',
          projectName: file.projectName,
        },
      });
      // Concepts are extracted only from curated docs/ markdown
      if (mdType !== 'doc') {
        continue;
      }
      const parsed = parseMarkdownFile(file.relativePath, file.absolutePath);
      for (const node of parsed.nodes) {
        addNode(node);
      }
      for (const [conceptId, text] of parsed.conceptTexts) {
        conceptTexts.set(conceptId, text);
      }
      for (const edge of parsed.edges) {
        addEdge(edge);
      }
    }
  }

  const controllerFiles = discovered.files.filter((f) => {
    if (f.languageOrKind !== 'ts' || f.stateSlice) {
      return false;
    }
    const base = f.relativePath.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? '';
    return base.endsWith('.controller.ts') || base.includes('controller.');
  });
  const gatewayFiles = discovered.files.filter((f) => {
    if (f.languageOrKind !== 'ts' || f.stateSlice) {
      return false;
    }
    const base = f.relativePath.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? '';
    return base.endsWith('.gateway.ts');
  });
  const apiSurfaceNodes = [...nodesById.values()].filter((n) => n.type === 'endpoint' || n.type === 'channel');
  const implementsEdges = linkImplements({
    controllerFiles,
    gatewayFiles,
    apiNodes: apiSurfaceNodes,
  });
  for (const edge of implementsEdges) {
    addEdge(edge);
  }

  const injectorFiles = discovered.files.filter((f) => {
    if (f.languageOrKind !== 'ts' || f.stateSlice) {
      return false;
    }
    const node = nodesById.get(fileNodeId(f.relativePath));
    return !!node && INJECTOR_SOURCE_TYPES.has(node.type);
  });
  const injectableTargetFiles = discovered.files.filter((f) => {
    if (f.languageOrKind !== 'ts' || f.stateSlice) {
      return false;
    }
    const node = nodesById.get(fileNodeId(f.relativePath));
    return (
      !!node &&
      (node.type === 'service' ||
        node.type === 'repository' ||
        node.type === 'guard' ||
        node.type === 'provider' ||
        node.type === 'job' ||
        node.type === 'controller' ||
        node.type === 'gateway')
    );
  });
  const injectsEdges = linkInjects({
    injectorFiles,
    targetFiles: injectableTargetFiles,
    nodes: [...nodesById.values()],
  });
  for (const edge of injectsEdges) {
    addEdge(edge);
  }

  const moduleFiles = discovered.files.filter((f) => {
    if (f.languageOrKind !== 'ts' || f.stateSlice) {
      return false;
    }
    const node = nodesById.get(fileNodeId(f.relativePath));
    return node?.type === 'module';
  });
  const moduleProvidesEdges = linkModuleProvides({
    moduleFiles,
    targetFiles: [...injectorFiles, ...injectableTargetFiles, ...moduleFiles],
    nodes: [...nodesById.values()],
  });
  for (const edge of moduleProvidesEdges) {
    addEdge(edge);
  }

  const frontendHttpServiceFiles = discovered.files.filter((f) => {
    if (f.languageOrKind !== 'ts' || f.stateSlice) {
      return false;
    }
    const node = nodesById.get(fileNodeId(f.relativePath));
    if (node?.type !== 'service') {
      return false;
    }
    const rel = f.relativePath.replace(/\\/g, '/');
    return rel.includes('/frontend/');
  });
  const httpCallEdges = linkHttpCalls({
    serviceFiles: frontendHttpServiceFiles,
    endpointNodes: apiSurfaceNodes,
  });
  for (const edge of httpCallEdges) {
    addEdge(edge);
  }

  const stateServiceEdges = linkStateServices([...nodesById.values()]);
  for (const edge of stateServiceEdges) {
    addEdge(edge);
  }

  const stateDirs = discovered.files
    .filter((f) => f.stateSlice)
    .map((f) => ({
      relativePath: f.relativePath,
      absolutePath: f.absolutePath,
      projectName: f.projectName,
      memberFiles: f.stateSlice?.memberFiles ?? [],
    }));
  const stateFacadeInjectEdges = linkStateFacadeInjects({
    stateDirs,
    serviceFiles: discovered.files.filter((f) => {
      if (f.languageOrKind !== 'ts' || f.stateSlice) {
        return false;
      }
      return nodesById.get(fileNodeId(f.relativePath))?.type === 'service';
    }),
    nodes: [...nodesById.values()],
  });
  for (const edge of stateFacadeInjectEdges) {
    addEdge(edge);
  }

  const documentEdges = linkDocuments({
    conceptNodes: [...nodesById.values()].filter((n) => n.type === 'concept'),
    projectNodes: [...nodesById.values()].filter((n) => n.type === 'app' || n.type === 'lib'),
    apiNodes: apiSurfaceNodes,
    conceptTexts,
  });
  for (const edge of documentEdges) {
    addEdge(edge);
  }

  const clusterSlice = buildClusterSlice({
    projectNodes: [...nodesById.values()].filter((n) => n.type === 'app' || n.type === 'lib'),
    fileNodes: [...nodesById.values()].filter((n) => n.type === 'doc'),
    conceptNodes: [...nodesById.values()].filter((n) => n.type === 'concept'),
  });
  for (const [projectId, updates] of clusterSlice.projectAttrUpdates) {
    const node = nodesById.get(projectId);
    if (!node) {
      continue;
    }
    node.attrs = { ...(node.attrs as ProjectNodeAttrs), ...updates };
  }
  for (const node of clusterSlice.nodes) {
    addNode(node);
  }
  for (const edge of clusterSlice.edges) {
    addEdge(edge);
  }

  return {
    version: 1,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    nodes: [...nodesById.values()],
    edges,
  };
}

export interface WriteKnowledgeGraphArtifactsOptions {
  graph: KnowledgeGraph;
  outDir: string;
  skipHtml?: boolean;
}

export function writeKnowledgeGraphArtifacts(options: WriteKnowledgeGraphArtifactsOptions): {
  jsonPath: string;
  htmlPath?: string;
} {
  const outDir = path.resolve(options.outDir);
  const jsonPath = writeGraphJsonAtomic(outDir, options.graph);
  let htmlPath: string | undefined;
  if (!options.skipHtml) {
    htmlPath = writeGraphHtml(outDir);
  }
  return { jsonPath, htmlPath };
}
