/* eslint-disable @typescript-eslint/no-var-requires */
import {
  CreateFileDto,
  FileNodeDto,
  MoveFileDto,
  type AgentFileManagerContext,
  type AgentFileType,
} from '@forepath/agenstra/backend/feature-agent-manager';
import { AuthenticationType } from '@forepath/identity/backend';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import axios, {
  AxiosError,
  AxiosRequestConfig,
  AxiosResponse,
  AxiosResponseHeaders,
  RawAxiosResponseHeaders,
} from 'axios';

import { ClientsRepository } from '../repositories/clients.repository';
import { getClientEndpointTlsPolicy, validateClientEndpointWithDnsOrThrow } from '../utils/client-endpoint-security';
import { buildClientProxyRequestHeaders } from '../utils/client-proxy-request-headers';

import { ClientsService } from './clients.service';

/**
 * Proxied binary file read result from a client's agent-manager.
 */
export interface ClientAgentFileProxyReadResult {
  buffer: Buffer;
  fileType: AgentFileType;
  contentType: string;
  status: number;
  contentRange?: string;
  contentDisposition?: string;
  acceptRanges?: string;
  size: number;
}

/**
 * Options for proxied file reads (Range / download disposition).
 */
export interface ClientAgentFileProxyReadOptions {
  range?: string;
  download?: boolean;
}

/**
 * Options for proxied file writes (chunked upload headers).
 */
export interface ClientAgentFileProxyWriteOptions {
  contentRange?: string;
  uploadId?: string;
  fileType?: string;
  contentType?: string;
}

function getResponseHeader(
  headers: RawAxiosResponseHeaders | AxiosResponseHeaders | undefined,
  name: string,
): string | undefined {
  if (!headers) {
    return undefined;
  }

  if (typeof (headers as AxiosResponseHeaders).get === 'function') {
    const value = (headers as AxiosResponseHeaders).get(name);

    return value == null ? undefined : String(value);
  }

  const record = headers as Record<string, unknown>;
  const value = record[name.toLowerCase()] ?? record[name];

  if (value == null) {
    return undefined;
  }

  return Array.isArray(value) ? String(value[0]) : String(value);
}

function parseJsonErrorMessage(data: unknown): string | undefined {
  try {
    let parsed: unknown = data;

    if (typeof data === 'string') {
      parsed = JSON.parse(data);
    } else if (Buffer.isBuffer(data)) {
      parsed = JSON.parse(data.toString('utf-8'));
    } else if (data instanceof ArrayBuffer) {
      parsed = JSON.parse(Buffer.from(data).toString('utf-8'));
    } else if (ArrayBuffer.isView(data)) {
      parsed = JSON.parse(Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf-8'));
    }

    if (parsed && typeof parsed === 'object' && 'message' in parsed) {
      const message = (parsed as { message?: unknown }).message;

      return typeof message === 'string' ? message : undefined;
    }
  } catch {
    // Fall through to generic message
  }

  return undefined;
}

/**
 * Service for proxying agent file system requests to client endpoints.
 * Handles authentication (API key or Keycloak JWT) and forwards file system requests to the client's agent-manager service.
 */
@Injectable()
export class ClientAgentFileSystemProxyService {
  private readonly logger = new Logger(ClientAgentFileSystemProxyService.name);

  constructor(
    private readonly clientsService: ClientsService,
    private readonly clientsRepository: ClientsRepository,
  ) {}

  /**
   * Get authentication header for a client.
   * @param clientId - The UUID of the client
   * @returns Authorization header value
   * @throws BadRequestException if client authentication is not properly configured
   */
  private async getAuthHeader(clientId: string): Promise<string> {
    const clientEntity = await this.clientsRepository.findByIdOrThrow(clientId);

    if (clientEntity.authenticationType === AuthenticationType.API_KEY) {
      if (!clientEntity.apiKey) {
        throw new BadRequestException('API key is not configured for this client');
      }

      return `Bearer ${clientEntity.apiKey}`;
    } else if (clientEntity.authenticationType === AuthenticationType.KEYCLOAK) {
      const token = await this.clientsService.getAccessToken(clientId);

      return `Bearer ${token}`;
    } else {
      throw new BadRequestException(`Unsupported authentication type: ${clientEntity.authenticationType}`);
    }
  }

  /**
   * Build the base URL for agent file system API requests.
   * @param endpoint - The client's endpoint URL
   * @returns The base URL for agent file system API requests
   */
  private buildAgentFilesApiUrl(endpoint: string, agentId: string): string {
    // Remove trailing slash if present
    const baseUrl = endpoint.replace(/\/$/, '');

    // Ensure /api/agents/{agentId}/files path
    return `${baseUrl}/api/agents/${agentId}/files`;
  }

  private extractErrorMessage(
    data: unknown,
    headers: RawAxiosResponseHeaders | AxiosResponseHeaders | undefined,
  ): string {
    const contentType = getResponseHeader(headers, 'content-type')?.toLowerCase() ?? '';

    if (contentType.includes('application/json')) {
      return parseJsonErrorMessage(data) || 'Request failed';
    }

    // Binary / opaque error bodies must not be treated as JSON
    if (data instanceof ArrayBuffer || ArrayBuffer.isView(data) || Buffer.isBuffer(data)) {
      return 'Request failed';
    }

    return parseJsonErrorMessage(data) || 'Request failed';
  }

  private throwForStatus(status: number, errorMessage: string): never {
    if (status === 404) {
      throw new NotFoundException(errorMessage);
    } else if (status === 400) {
      throw new BadRequestException(errorMessage);
    } else {
      throw new BadRequestException(`Request failed: ${errorMessage}`);
    }
  }

  /**
   * Make an HTTP request to the client's agent-manager service for JSON file operations.
   * @param clientId - The UUID of the client
   * @param agentId - The UUID of the agent
   * @param config - Axios request configuration
   * @returns The response data
   * @throws NotFoundException if client or agent is not found
   * @throws BadRequestException if request fails
   */
  private async makeRequest<T>(clientId: string, agentId: string, config: AxiosRequestConfig): Promise<T> {
    const clientEntity = await this.clientsRepository.findByIdOrThrow(clientId);

    await validateClientEndpointWithDnsOrThrow(clientEntity.endpoint);
    const authHeader = await this.getAuthHeader(clientId);
    const baseUrl = this.buildAgentFilesApiUrl(clientEntity.endpoint, agentId);
    const tlsPolicy = getClientEndpointTlsPolicy(this.logger);

    try {
      this.logger.debug(
        `Proxying file system request to ${baseUrl}${config.url || ''} for client ${clientId}, agent ${agentId}`,
      );

      const response = await axios.request<T>({
        ...config,
        url: config.url ? `${baseUrl}${config.url}` : baseUrl,
        headers: buildClientProxyRequestHeaders(config.headers, authHeader),
        validateStatus: (status) => status < 500, // Don't throw on 4xx errors
        httpsAgent: baseUrl.startsWith('https://')
          ? new (require('https').Agent)({
              rejectUnauthorized: tlsPolicy.rejectUnauthorized,
            })
          : undefined,
      });

      // Handle error responses
      if (response.status >= 400) {
        const errorMessage = this.extractErrorMessage(response.data, response.headers);

        this.logger.error(
          `Request to ${baseUrl}${config.url || ''} failed with status ${response.status}: ${errorMessage}`,
        );
        this.throwForStatus(response.status, errorMessage);
      }

      return response.data;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }

      const axiosError = error as AxiosError;

      if (axiosError.response) {
        const errorMessage = this.extractErrorMessage(axiosError.response.data, axiosError.response.headers);

        this.logger.error(`Request to ${baseUrl}${config.url || ''} failed: ${errorMessage}`, axiosError.response.data);
        this.throwForStatus(axiosError.response.status, errorMessage);
      } else if (axiosError.request) {
        this.logger.error(`No response received from ${baseUrl}${config.url || ''}: ${axiosError.message}`);
        throw new BadRequestException(`Failed to connect to client endpoint: ${axiosError.message}`);
      } else {
        this.logger.error(`Error setting up request to ${baseUrl}${config.url || ''}: ${axiosError.message}`);
        throw new BadRequestException(`Request setup failed: ${axiosError.message}`);
      }
    }
  }

  /**
   * Make a binary HTTP request to the client's agent-manager (arraybuffer response).
   * Returns the full Axios response so callers can forward status and headers.
   */
  private async makeBinaryRequest(
    clientId: string,
    agentId: string,
    config: AxiosRequestConfig,
    contentType = 'application/octet-stream',
  ): Promise<AxiosResponse<ArrayBuffer>> {
    const clientEntity = await this.clientsRepository.findByIdOrThrow(clientId);

    await validateClientEndpointWithDnsOrThrow(clientEntity.endpoint);
    const authHeader = await this.getAuthHeader(clientId);
    const baseUrl = this.buildAgentFilesApiUrl(clientEntity.endpoint, agentId);
    const tlsPolicy = getClientEndpointTlsPolicy(this.logger);

    try {
      this.logger.debug(
        `Proxying binary file request to ${baseUrl}${config.url || ''} for client ${clientId}, agent ${agentId}`,
      );

      const response = await axios.request<ArrayBuffer>({
        ...config,
        url: config.url ? `${baseUrl}${config.url}` : baseUrl,
        responseType: 'arraybuffer',
        headers: buildClientProxyRequestHeaders(config.headers, authHeader, contentType),
        validateStatus: (status) => status < 500,
        httpsAgent: baseUrl.startsWith('https://')
          ? new (require('https').Agent)({
              rejectUnauthorized: tlsPolicy.rejectUnauthorized,
            })
          : undefined,
      });

      // 416 is a valid Range outcome (e.g. empty files) and must be forwarded to the client.
      if (response.status >= 400 && response.status !== 416) {
        const errorMessage = this.extractErrorMessage(response.data, response.headers);

        this.logger.error(
          `Request to ${baseUrl}${config.url || ''} failed with status ${response.status}: ${errorMessage}`,
        );
        this.throwForStatus(response.status, errorMessage);
      }

      return response;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }

      const axiosError = error as AxiosError;

      if (axiosError.response) {
        const errorMessage = this.extractErrorMessage(axiosError.response.data, axiosError.response.headers);

        this.logger.error(`Request to ${baseUrl}${config.url || ''} failed: ${errorMessage}`);
        this.throwForStatus(axiosError.response.status, errorMessage);
      } else if (axiosError.request) {
        this.logger.error(`No response received from ${baseUrl}${config.url || ''}: ${axiosError.message}`);
        throw new BadRequestException(`Failed to connect to client endpoint: ${axiosError.message}`);
      } else {
        this.logger.error(`Error setting up request to ${baseUrl}${config.url || ''}: ${axiosError.message}`);
        throw new BadRequestException(`Request setup failed: ${axiosError.message}`);
      }
    }
  }

  /**
   * Probe file metadata via HEAD (no body).
   */
  async probeFile(
    clientId: string,
    agentId: string,
    filePath: string,
    context: AgentFileManagerContext = 'app',
  ): Promise<Pick<ClientAgentFileProxyReadResult, 'fileType' | 'contentType' | 'size' | 'acceptRanges'>> {
    const encodedPath = encodeURIComponent(filePath);
    const params: Record<string, string> = {};

    if (context === 'config') {
      params.context = 'config';
    }

    const response = await this.makeBinaryRequest(clientId, agentId, {
      method: 'HEAD',
      url: `/${encodedPath}`,
      params: Object.keys(params).length ? params : undefined,
    });

    const fileTypeHeader = getResponseHeader(response.headers, 'x-file-type');
    const contentTypeHeader = getResponseHeader(response.headers, 'content-type') || 'application/octet-stream';
    const contentLength = getResponseHeader(response.headers, 'content-length');
    const acceptRanges = getResponseHeader(response.headers, 'accept-ranges');
    const fileType: AgentFileType =
      fileTypeHeader === 'text' ||
      fileTypeHeader === 'binary' ||
      fileTypeHeader === 'pdf' ||
      fileTypeHeader === 'image' ||
      fileTypeHeader === 'video' ||
      fileTypeHeader === 'audio'
        ? fileTypeHeader
        : 'binary';

    return {
      fileType,
      contentType: contentTypeHeader,
      acceptRanges,
      size: contentLength ? Number(contentLength) : 0,
    };
  }

  /**
   * Read file content from agent container via client proxy as raw bytes.
   * Forwards Range and download query; returns buffer plus response metadata headers.
   */
  async readFile(
    clientId: string,
    agentId: string,
    filePath: string,
    context: AgentFileManagerContext = 'app',
    options?: ClientAgentFileProxyReadOptions,
  ): Promise<ClientAgentFileProxyReadResult> {
    const encodedPath = encodeURIComponent(filePath);
    const params: Record<string, string> = {};

    if (context === 'config') {
      params.context = 'config';
    }

    if (options?.download) {
      params.download = 'true';
    }

    const headers: Record<string, string> = {};

    if (options?.range) {
      headers.Range = options.range;
    }

    const response = await this.makeBinaryRequest(clientId, agentId, {
      method: 'GET',
      url: `/${encodedPath}`,
      params: Object.keys(params).length ? params : undefined,
      headers: Object.keys(headers).length ? headers : undefined,
    });

    const buffer = Buffer.from(response.data);
    const contentTypeHeader = getResponseHeader(response.headers, 'content-type') || 'application/octet-stream';
    const fileTypeHeader = getResponseHeader(response.headers, 'x-file-type');
    const contentLength = getResponseHeader(response.headers, 'content-length');
    const contentRange = getResponseHeader(response.headers, 'content-range');
    const contentDisposition = getResponseHeader(response.headers, 'content-disposition');
    const acceptRanges = getResponseHeader(response.headers, 'accept-ranges');

    const fileType: AgentFileType =
      fileTypeHeader === 'text' ||
      fileTypeHeader === 'binary' ||
      fileTypeHeader === 'pdf' ||
      fileTypeHeader === 'image' ||
      fileTypeHeader === 'video' ||
      fileTypeHeader === 'audio'
        ? fileTypeHeader
        : 'binary';

    return {
      buffer,
      fileType,
      contentType: contentTypeHeader,
      status: response.status,
      contentRange,
      contentDisposition,
      acceptRanges,
      size: contentLength ? Number(contentLength) : buffer.length,
    };
  }

  /**
   * Write file content to agent container via client proxy as raw bytes.
   * Optional Content-Range + X-Upload-Id enable chunked uploads on the manager.
   */
  async writeFile(
    clientId: string,
    agentId: string,
    filePath: string,
    buffer: Buffer,
    context: AgentFileManagerContext = 'app',
    options?: ClientAgentFileProxyWriteOptions,
  ): Promise<void> {
    const encodedPath = encodeURIComponent(filePath);
    const headers: Record<string, string> = {};

    if (options?.contentRange) {
      headers['Content-Range'] = options.contentRange;
    }

    if (options?.uploadId) {
      headers['X-Upload-Id'] = options.uploadId;
    }

    if (options?.fileType) {
      headers['X-File-Type'] = options.fileType;
    }

    await this.makeBinaryRequest(
      clientId,
      agentId,
      {
        method: 'PUT',
        url: `/${encodedPath}`,
        data: buffer,
        params: context === 'config' ? { context: 'config' } : undefined,
        headers: Object.keys(headers).length ? headers : undefined,
      },
      options?.contentType || 'application/octet-stream',
    );
  }

  /**
   * List directory contents in agent container via client proxy.
   * @param clientId - The UUID of the client
   * @param agentId - The UUID of the agent
   * @param path - Optional directory path (defaults to '.')
   * @returns Array of file nodes
   */
  async listDirectory(
    clientId: string,
    agentId: string,
    path?: string,
    context: AgentFileManagerContext = 'app',
  ): Promise<FileNodeDto[]> {
    const params: Record<string, string> = {};

    if (path) {
      params.path = path;
    }

    if (context === 'config') {
      params.context = 'config';
    }

    return await this.makeRequest<FileNodeDto[]>(clientId, agentId, {
      method: 'GET',
      params: Object.keys(params).length ? params : undefined,
    });
  }

  /**
   * Create an empty file or directory in agent container via client proxy.
   * Write content separately via PUT raw bytes.
   */
  async createFileOrDirectory(
    clientId: string,
    agentId: string,
    filePath: string,
    createFileDto: CreateFileDto,
    context: AgentFileManagerContext = 'app',
  ): Promise<void> {
    const encodedPath = encodeURIComponent(filePath);

    await this.makeRequest<void>(clientId, agentId, {
      method: 'POST',
      url: `/${encodedPath}`,
      data: createFileDto,
      params: context === 'config' ? { context: 'config' } : undefined,
    });
  }

  /**
   * Delete a file or directory from agent container via client proxy.
   * @param clientId - The UUID of the client
   * @param agentId - The UUID of the agent
   * @param filePath - The relative path to delete (from /app)
   */
  async deleteFileOrDirectory(
    clientId: string,
    agentId: string,
    filePath: string,
    context: AgentFileManagerContext = 'app',
  ): Promise<void> {
    const encodedPath = encodeURIComponent(filePath);

    await this.makeRequest<void>(clientId, agentId, {
      method: 'DELETE',
      url: `/${encodedPath}`,
      params: context === 'config' ? { context: 'config' } : undefined,
    });
  }

  /**
   * Move a file or directory in agent container via client proxy.
   * @param clientId - The UUID of the client
   * @param agentId - The UUID of the agent
   * @param sourcePath - The relative path to the source file/directory (from /app)
   * @param moveFileDto - The move operation data (destination path)
   */
  async moveFileOrDirectory(
    clientId: string,
    agentId: string,
    sourcePath: string,
    moveFileDto: MoveFileDto,
    context: AgentFileManagerContext = 'app',
  ): Promise<void> {
    const encodedPath = encodeURIComponent(sourcePath);

    await this.makeRequest<void>(clientId, agentId, {
      method: 'PATCH',
      url: `/${encodedPath}`,
      data: moveFileDto,
      params: context === 'config' ? { context: 'config' } : undefined,
    });
  }
}
