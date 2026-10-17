import { Injectable, Logger } from '@nestjs/common';

/** Env var for posture plugins: MDM (Intune, Jamf, Kandji), EDR (Defender, CrowdStrike, SentinelOne), certificates. */
export const DYNAMIC_POSTURE_PLUGINS_ENV = 'DYNAMIC_POSTURE_PLUGINS';

/** What a posture plugin learns about a device. */
export interface PostureDevice {
  /** Loadweaver client id. */
  id: string;
  /** Owner's email / user id, or `machine`. */
  owner: string;
  name: string;
  platform: string;
  /** MDM / EDR device id or serial reported by the client. */
  deviceId?: string;
}

/** `compliant` for MDMs, risk levels for EDRs; anything the plugin can't decide is `unknown` (3.31). */
export type PostureVerdict = 'compliant' | 'non-compliant' | 'low-risk' | 'medium-risk' | 'high-risk' | 'unknown';

export interface PosturePlugin {
  readonly id: string;
  check(device: PostureDevice): Promise<{ verdict: PostureVerdict; detail?: string }>;
}

export interface PosturePluginFactory<C = Record<string, string>> {
  readonly id: string;
  readonly displayName: string;
  create(config: C): PosturePlugin;
}

/** Posture plugin factories, all from plugins, looked up by the `type` in a client group's posture rules. */
@Injectable()
export class PosturePluginRegistry {
  private readonly logger = new Logger(PosturePluginRegistry.name);
  private readonly factories = new Map<string, PosturePluginFactory<never>>();

  register<C>(factory: PosturePluginFactory<C>): void {
    if (this.factories.has(factory.id)) {
      this.logger.warn(`Posture plugin ${factory.id} registered twice; keeping the first`);

      return;
    }

    this.factories.set(factory.id, factory as PosturePluginFactory<never>);
  }

  list(): { id: string; displayName: string }[] {
    return [...this.factories.values()].map((f) => ({ id: f.id, displayName: f.displayName }));
  }

  has(id: string): boolean {
    return this.factories.has(id);
  }

  create<C>(id: string, config: C): PosturePlugin {
    const factory = this.factories.get(id) as PosturePluginFactory<C> | undefined;

    if (!factory) throw new Error(`unknown posture plugin ${id}`);

    return factory.create(config);
  }
}
