import { mkdir, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { dirname } from 'node:path';

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

import { VolumeManager } from './volume.manager';

export function pluginSocketPath(env: NodeJS.ProcessEnv = process.env): string {
  return env['LOADWEAVER_VOLUME_PLUGIN_SOCKET'] || '/run/docker/plugins/loadweaver.sock';
}

const MAX_BODY_BYTES = 64 * 1024;

type Handler = (body: Record<string, unknown>) => Promise<Record<string, unknown>>;

/**
 * Docker volume plugin `loadweaver` (legacy plugin protocol over a unix socket only Docker / root can reach).
 * Volumes are created and removed by the control plane; Docker only mounts and unmounts them.
 */
@Injectable()
export class VolumePluginServer implements OnModuleDestroy {
  private readonly logger = new Logger(VolumePluginServer.name);
  private server: Server | null = null;

  constructor(private readonly volumes: VolumeManager) {}

  readonly handlers: Record<string, Handler> = {
    '/Plugin.Activate': async () => ({ Implements: ['VolumeDriver'] }),
    '/VolumeDriver.Capabilities': async () => ({ Capabilities: { Scope: 'local' } }),
    '/VolumeDriver.Create': async (body) =>
      this.volumes.byDockerName(String(body['Name']))
        ? { Err: '' }
        : { Err: 'volumes are created by the Loadweaver control plane' },
    '/VolumeDriver.Remove': async () => ({ Err: '' }),
    '/VolumeDriver.Get': async (body) => {
      const volume = this.volumes.byDockerName(String(body['Name']));

      return volume
        ? { Volume: { Name: volume.dockerName, Mountpoint: this.volumes.mountpoint(volume) }, Err: '' }
        : { Err: 'no such volume' };
    },
    '/VolumeDriver.List': async () => ({ Volumes: [], Err: '' }),
    '/VolumeDriver.Path': async (body) => {
      const volume = this.volumes.byDockerName(String(body['Name']));

      return volume ? { Mountpoint: this.volumes.mountpoint(volume), Err: '' } : { Err: 'no such volume' };
    },
    '/VolumeDriver.Mount': async (body) => {
      try {
        return { Mountpoint: await this.volumes.mount(String(body['Name'])), Err: '' };
      } catch (error) {
        return { Err: error instanceof Error ? error.message : 'mount failed' };
      }
    },
    '/VolumeDriver.Unmount': async (body) => {
      await this.volumes.unmount(String(body['Name']));

      return { Err: '' };
    },
  };

  async start(): Promise<void> {
    if (this.server) return;

    const path = pluginSocketPath();

    await mkdir(dirname(path), { recursive: true });
    await rm(path, { force: true });

    const server = createServer((req, res) => void this.handle(req, res));

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(path, () => resolve());
    });
    this.server = server;
  }

  onModuleDestroy(): void {
    this.server?.close();
    this.server = null;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const handler = req.method === 'POST' && req.url ? this.handlers[req.url] : undefined;
    const send = (status: number, payload: Record<string, unknown>) => {
      res.writeHead(status, { 'Content-Type': 'application/vnd.docker.plugins.v1.2+json' });
      res.end(JSON.stringify(payload));
    };

    if (!handler) return send(404, { Err: 'unknown endpoint' });

    let size = 0;
    const chunks: Buffer[] = [];

    for await (const chunk of req) {
      size += (chunk as Buffer).length;

      if (size > MAX_BODY_BYTES) return send(413, { Err: 'request too large' });

      chunks.push(chunk as Buffer);
    }

    let body: Record<string, unknown> = {};

    try {
      body = chunks.length ? (JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>) : {};
    } catch {
      return send(400, { Err: 'invalid JSON' });
    }

    try {
      send(200, await handler(body));
    } catch (error) {
      this.logger.warn(`${req.url}: ${error instanceof Error ? error.message : String(error)}`);
      send(200, { Err: 'volume operation failed' });
    }
  }
}
