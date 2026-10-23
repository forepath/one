import type { PostureCategory, PostureRiskLevel } from '@forepath/loadweaver/shared/util-model';
import { Injectable, Logger } from '@nestjs/common';

import type { PostureHttp } from '../posture/posture-http';

/**
 * Env var for posture plugins beyond the built-in ones (MDM: Intune, Jamf Pro, Kandji; EDR: Defender for Endpoint,
 * CrowdStrike Falcon, SentinelOne), loaded like the other dynamic providers.
 */
export const DYNAMIC_POSTURE_PLUGINS_ENV = 'DYNAMIC_POSTURE_PLUGINS';

export type PostureStatus = 'compliant' | 'non-compliant' | 'unknown';
/** Keys a vendor record can be matched to an enrolled device by (configurable per integration). */
export const POSTURE_MATCH_KEYS = ['serial', 'deviceId', 'hostname'] as const;
export type PostureMatchKey = (typeof POSTURE_MATCH_KEYS)[number];
/**
 * Hostnames are self-reported, not unique and easy to copy: a device reporting another device's name would inherit
 * its verdict. No plugin matches by hostname by default; an integration that opts in gets this warning (API +
 * console) and should require the device user to match the client owner (`requireUserMatch`).
 */
export const HOSTNAME_MATCH_WARNING =
  'Matching by hostname is weak: hostnames are self-reported and not unique, so another device reporting the same name could inherit this verdict. Prefer serial / device id, require the device user to match and combine with device.certificate.valid.';

/** A device as an MDM / EDR knows it, already normalized by the plugin. */
export interface PostureVendorDevice {
  /** The vendor's id of the record (Intune managed device id, CrowdStrike AID, …). */
  externalId: string;
  serial?: string;
  hostname?: string;
  /** Ids a client may report as `deviceId` (vendor id, Entra / Azure AD device id, agent UUID). */
  deviceIds: string[];
  lastSeen?: string;
  status: PostureStatus;
  /** EDRs: normalized risk level. */
  risk?: PostureRiskLevel;
  /** Why it isn't compliant / why the risk is what it is (shown to the user). */
  reasons: string[];
  /**
   * The device's user(s) as the vendor records them (e-mail / UPN, lower-cased), for plugins with
   * `supportsUserMatch`; compared with the VPN client's owner when the integration requires a user match.
   */
  users?: string[];
}

/** A configuration field an integration needs (rendered by the console, validated by the plugin). */
export interface PostureConfigField {
  key: string;
  label: string;
  /** Secrets are stored encrypted and never returned by the API. */
  secret?: boolean;
  required?: boolean;
  /** Choices for select fields. */
  options?: readonly string[];
  default?: string;
  description?: string;
}

export interface PosturePluginContext {
  /** HTTP client bound to the integration's allowed hosts (HTTPS only, timeouts, retries / backoff). */
  http: PostureHttp;
}

export interface PosturePlugin {
  readonly id: string;
  readonly category: PostureCategory;
  /** Authenticates and reads one page; resolves with a short description, rejects with the reason. */
  testConnection(ctx: PosturePluginContext): Promise<string>;
  /** The vendor's device inventory, normalized. */
  fetchDevices(ctx: PosturePluginContext): Promise<PostureVendorDevice[]>;
  /** Per-device details that cost extra calls (only for devices matched to enrolled clients). */
  enrich?(ctx: PosturePluginContext, devices: PostureVendorDevice[]): Promise<PostureVendorDevice[]>;
}

export interface PosturePluginFactory {
  readonly id: string;
  readonly displayName: string;
  readonly category: PostureCategory;
  readonly fields: readonly PostureConfigField[];
  readonly defaultMatchBy: readonly PostureMatchKey[];
  /** The vendor record carries the device's user (e-mail / UPN): integrations require it to match by default. */
  readonly supportsUserMatch?: boolean;
  /**
   * Validates a configuration and returns the hosts the plugin may call (outbound calls go nowhere else). Throws
   * with a message for invalid configurations.
   */
  allowedHosts(config: Readonly<Record<string, string>>): string[];
  create(config: Readonly<Record<string, string>>): PosturePlugin;
}

export interface PosturePluginInfo {
  id: string;
  displayName: string;
  category: PostureCategory;
  fields: PostureConfigField[];
  defaultMatchBy: PostureMatchKey[];
  supportsUserMatch: boolean;
}

/** Posture plugin factories (built-in first, then `DYNAMIC_POSTURE_PLUGINS`), looked up by integration type. */
@Injectable()
export class PosturePluginRegistry {
  private readonly logger = new Logger(PosturePluginRegistry.name);
  private readonly factories = new Map<string, PosturePluginFactory>();

  register(factory: PosturePluginFactory): void {
    if (this.factories.has(factory.id)) {
      this.logger.warn(`Posture plugin ${factory.id} registered twice; keeping the first`);

      return;
    }

    this.factories.set(factory.id, factory);
  }

  list(): PosturePluginInfo[] {
    return [...this.factories.values()].map((f) => ({
      id: f.id,
      displayName: f.displayName,
      category: f.category,
      fields: f.fields.map((field) => ({ ...field })),
      defaultMatchBy: [...f.defaultMatchBy],
      supportsUserMatch: f.supportsUserMatch === true,
    }));
  }

  has(id: string): boolean {
    return this.factories.has(id);
  }

  get(id: string): PosturePluginFactory {
    const factory = this.factories.get(id);

    if (!factory) throw new Error(`unknown posture plugin ${id}`);

    return factory;
  }
}
