import { readFile, rename, writeFile } from 'node:fs/promises';

import type { ExternalBgp, NodeNetworkConfig } from '@forepath/loadweaver/shared/util-agent-protocol';
import { Injectable } from '@nestjs/common';

import { CommandRunner } from '../host/command-runner';
import { renderBird } from './bird.renderer';

export function birdConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return env['LOADWEAVER_BIRD_CONFIG'] || '/etc/bird/bird.conf';
}

/**
 * Writes the BIRD configuration and reloads it: parse-checked first (`bird -p`), then swapped in atomically
 * and applied with `birdc configure`, which keeps established sessions where the change allows it.
 */
@Injectable()
export class BirdManager {
  constructor(private readonly commands: CommandRunner) {}

  async apply(config: NodeNetworkConfig, external?: ExternalBgp): Promise<boolean> {
    const path = birdConfigPath();
    const rendered = renderBird(config, external);
    const current = await readFile(path, 'utf8').catch(() => null);

    if (current === rendered) return false;

    const candidate = `${path}.loadweaver-new`;

    await writeFile(candidate, rendered, { mode: 0o640 });
    await this.commands.run('bird', ['-p', '-c', candidate]);
    await rename(candidate, path);
    await this.commands.run('birdc', ['configure']);

    return true;
  }
}
