import { AGENT_GRAPH_LIMITS } from '@forepath/agenstra/shared/util-opencode-config';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import type { AgentEntity } from '../entities/agent.entity';
import { AgentProviderFactory } from '../providers/agent-provider.factory';
import { DEFAULT_AGENT_WORKSPACE_ROOT, normalizeWorkspaceRoot } from '../utils/agent-file-path.utils';
import type { AgentGraphListedEntry, AgentGraphParsedFile } from '../utils/agent-graph-builder.utils';
import {
  AGENT_GRAPH_ARCHIVE_ACCEPTED_EXIT_CODES,
  batchAgentGraphArchivePaths,
  buildAgentGraphArchiveCommand,
  buildAgentGraphListingCommand,
  parseAgentGraphArchive,
  parseAgentGraphListing,
} from '../utils/agent-graph-collect.utils';
import {
  agentGraphInstructionKindOf,
  agentGraphLanguageOf,
  AGENT_GRAPH_CODE_LANGUAGES,
  AGENT_GRAPH_DOC_LANGUAGES,
  isAgentGraphManifest,
  shouldParseAgentGraphFile,
} from '../utils/agent-graph-files.utils';
import { parseAgentGraphManifest } from '../utils/agent-graph-manifests.utils';
import { scanAgentGraphDocument, scanAgentGraphSource } from '../utils/agent-graph-scanners.utils';

import { DockerService } from './docker.service';

export interface AgentGraphCollection {
  workingDirectory: string;
  listing: AgentGraphListedEntry[];
  parsed: Record<string, AgentGraphParsedFile>;
  truncated: boolean;
  /** Files streamed in this run (the rest was reused from the previous build). */
  streamedFiles: number;
}

/** Same unprivileged user the workspace file API uses: it can only read what the agent itself can read. */
const GRAPH_EXEC_USER = 'agenstra';
const LISTING_TIMEOUT_MS = 120_000;
const ARCHIVE_TIMEOUT_MS = 180_000;
/** Bytes per listing record are small; this bounds pathological file names. */
const LISTING_MAX_BYTES = 32 * 1024 * 1024;

/**
 * Collects the inputs of an environment graph from the worker: a `find` listing of the working directory and a `tar`
 * stream of the files worth parsing. Both run read-only as the workspace user; output is parsed in memory. Files whose
 * size / mtime did not change since the previous build reuse their earlier scan result (incremental rebuilds).
 */
@Injectable()
export class AgentGraphCollectorService {
  private readonly logger = new Logger(AgentGraphCollectorService.name);

  constructor(
    private readonly dockerService: DockerService,
    private readonly providerFactory: AgentProviderFactory,
  ) {}

  workingDirectoryOf(agent: Pick<AgentEntity, 'agentType'>): string {
    try {
      const basePath = this.providerFactory.getProvider(agent.agentType || 'opencode').getBasePath?.();

      return normalizeWorkspaceRoot(basePath || DEFAULT_AGENT_WORKSPACE_ROOT);
    } catch {
      return DEFAULT_AGENT_WORKSPACE_ROOT;
    }
  }

  async collect(
    agent: AgentEntity,
    previous: Record<string, AgentGraphParsedFile> | null | undefined,
  ): Promise<AgentGraphCollection> {
    if (!agent.containerId) {
      throw new NotFoundException(`Agent ${agent.id} has no associated container`);
    }

    const workingDirectory = this.workingDirectoryOf(agent);
    const listingResult = await this.dockerService.collectExecStdout(
      agent.containerId,
      buildAgentGraphListingCommand(workingDirectory, AGENT_GRAPH_LIMITS.maxListedFiles),
      { user: GRAPH_EXEC_USER, maxBytes: LISTING_MAX_BYTES, timeoutMs: LISTING_TIMEOUT_MS },
    );
    const listing = parseAgentGraphListing(listingResult.stdout);
    let truncated = listingResult.truncated || listing.length >= AGENT_GRAPH_LIMITS.maxListedFiles;
    const candidates = this.selectParseCandidates(listing);

    if (candidates.truncated) {
      truncated = true;
    }

    const parsed: Record<string, AgentGraphParsedFile> = {};
    const toStream: AgentGraphListedEntry[] = [];

    for (const entry of candidates.files) {
      const earlier = previous?.[entry.path];

      if (earlier && earlier.size === entry.size && earlier.mtime === entry.mtime) {
        parsed[entry.path] = earlier;
      } else {
        toStream.push(entry);
      }
    }

    const sizeByPath = new Map(toStream.map((entry) => [entry.path, entry]));

    for (const batch of batchAgentGraphArchivePaths(toStream.map((entry) => entry.path))) {
      const expectedBytes = batch.reduce((sum, path) => sum + (sizeByPath.get(path)?.size ?? 0) + 1536, 10_240);

      try {
        const archive = await this.dockerService.collectExecStdout(
          agent.containerId,
          buildAgentGraphArchiveCommand(workingDirectory, batch),
          {
            user: GRAPH_EXEC_USER,
            // Files may grow between listing and archiving; the archive parser tolerates a cut-off tail.
            maxBytes: Math.min(expectedBytes * 2, AGENT_GRAPH_LIMITS.maxParsedTotalBytes),
            timeoutMs: ARCHIVE_TIMEOUT_MS,
            acceptExitCodes: AGENT_GRAPH_ARCHIVE_ACCEPTED_EXIT_CODES,
          },
        );

        for (const [path, content] of parseAgentGraphArchive(archive.stdout, AGENT_GRAPH_LIMITS.maxParsedFileBytes)) {
          const entry = sizeByPath.get(path);

          if (entry) {
            parsed[path] = scanAgentGraphFile(path, content, entry.size ?? content.length, entry.mtime ?? 0);
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        this.logger.warn(`Graph archive batch for agent ${agent.id} failed (${batch.length} files): ${message}`);
        truncated = true;
      }
    }

    return { workingDirectory, listing, parsed, truncated, streamedFiles: toStream.length };
  }

  /**
   * Files worth parsing, bounded by count and total bytes. Manifests and instruction files come first, then docs and
   * code by depth (shallow files describe structure best).
   */
  private selectParseCandidates(listing: AgentGraphListedEntry[]): {
    files: AgentGraphListedEntry[];
    truncated: boolean;
  } {
    const eligible = listing.filter(
      (entry) =>
        entry.kind === 'file' &&
        shouldParseAgentGraphFile(entry.path, entry.size ?? 0, AGENT_GRAPH_LIMITS.maxParsedFileBytes),
    );
    const rank = (entry: AgentGraphListedEntry): number =>
      isAgentGraphManifest(entry.path) ? 0 : agentGraphInstructionKindOf(entry.path) ? 1 : 2;

    eligible.sort(
      (a, b) =>
        rank(a) - rank(b) || a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path),
    );

    const files: AgentGraphListedEntry[] = [];
    let bytes = 0;

    for (const entry of eligible) {
      if (
        files.length >= AGENT_GRAPH_LIMITS.maxParsedFiles ||
        bytes + (entry.size ?? 0) > AGENT_GRAPH_LIMITS.maxParsedTotalBytes
      ) {
        return { files, truncated: true };
      }

      files.push(entry);
      bytes += entry.size ?? 0;
    }

    return { files, truncated: false };
  }
}

/** Scan one file's content into its persisted form (structure only; the content itself is dropped). */
export function scanAgentGraphFile(path: string, content: string, size: number, mtime: number): AgentGraphParsedFile {
  const language = agentGraphLanguageOf(path);
  const instructionKind = agentGraphInstructionKindOf(path);
  const result: AgentGraphParsedFile = { path, size, mtime, ...(language ? { language } : {}) };

  if (isAgentGraphManifest(path)) {
    const manifest = parseAgentGraphManifest(path, content);

    if (manifest) {
      result.manifest = manifest;
    }
  }

  if (instructionKind) {
    result.instructionKind = instructionKind;
  }

  if (language && AGENT_GRAPH_CODE_LANGUAGES.has(language)) {
    result.source = scanAgentGraphSource(language, content);
  } else if ((language && AGENT_GRAPH_DOC_LANGUAGES.has(language)) || instructionKind) {
    result.doc = scanAgentGraphDocument(content);
  }

  return result;
}
