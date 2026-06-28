import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { CloudInitConfigOrderFieldDto } from '../dto/cloud-init-config-response.dto';
import { OrderProvisioningOptionDto } from '../dto/order-provisioning-option.dto';
import {
  CloudInitConfigEntity,
  CloudInitConfigEnvVariableDefinition,
  CloudInitProvisioningMode,
} from '../entities/cloud-init-config.entity';
import { CloudInitConfigsRepository } from '../repositories/cloud-init-configs.repository';
import { ServicePlansRepository } from '../repositories/service-plans.repository';
import { ServiceTypesRepository } from '../repositories/service-types.repository';
import {
  collectCustomCloudInitConfigIdsFromPlanDefaults,
  encodeProvisioningOptionKey,
  parsePlanProvisioningOptions,
  resolvePlanProvisioningOptions,
  type PlanProvisioningOption,
} from '../utils/cloud-init/plan-provisioning-options.utils';
import {
  CloudInitTemplateContext,
  interpolateCloudInitTemplate,
} from '../utils/cloud-init/template-interpolation.utils';
import { quoteShellLiteral, validateCloudInitWorkDir } from '../utils/cloud-init/work-dir.utils';
import { generateSecureRandomString, normalizeRandomDefaultLength } from '../utils/generate-secure-random.utils';

const ENV_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const SERVICE_PLAN_REFERENCE_BATCH_SIZE = 100;

const SAMPLE_TEMPLATE_CONTEXT: CloudInitTemplateContext = {
  hostname: 'sample-host',
  fqdn: 'sample-host.example.com',
  workDir: '/opt/custom-app',
  sshPublicKey: 'ssh-rsa SAMPLE',
  dockerImage: 'nginx:alpine',
  containerPort: 8080,
  hostPort: 80,
  environment: {},
};

export interface SanitizedEnvVariablesResult {
  environmentVariables: CloudInitConfigEnvVariableDefinition[];
  envDefaultValues: Record<string, string>;
}

export interface CloudInitProvisioningPayload {
  provisioningMode: CloudInitProvisioningMode;
  dockerImage?: string | null;
  containerPort?: number;
  hostPort?: number;
  workDir?: string;
  dockerComposeTemplate?: string | null;
  userDataTemplate?: string | null;
  environmentVariables: CloudInitConfigEnvVariableDefinition[];
}

@Injectable()
export class CloudInitConfigService {
  constructor(
    private readonly cloudInitConfigsRepository: CloudInitConfigsRepository,
    private readonly servicePlansRepository: ServicePlansRepository,
    private readonly serviceTypesRepository: ServiceTypesRepository,
  ) {}

  sanitizeEnvironmentVariables(
    defs: CloudInitConfigEnvVariableDefinition[] | undefined,
    defaultValues: Record<string, string> | undefined,
  ): SanitizedEnvVariablesResult {
    const sanitizedDefaults: Record<string, string> = {};
    const seenKeys = new Set<string>();
    const environmentVariables: CloudInitConfigEnvVariableDefinition[] = [];

    for (const raw of defs ?? []) {
      const key = raw.key?.trim() ?? '';
      const label = raw.label?.trim() ?? '';

      if (!key || !label) {
        continue;
      }

      if (!ENV_KEY_PATTERN.test(key)) {
        throw new BadRequestException(
          `Invalid environment variable key "${key}": must match ${ENV_KEY_PATTERN.source}`,
        );
      }

      if (seenKeys.has(key)) {
        throw new BadRequestException(`Duplicate environment variable key: ${key}`);
      }

      seenKeys.add(key);

      const defaultValue = raw.useRandomDefault === true ? undefined : defaultValues?.[key]?.trim();
      const useRandomDefault = raw.useRandomDefault === true;

      environmentVariables.push({
        key,
        label,
        description: raw.description?.trim() || undefined,
        showInOrderForm: raw.showInOrderForm === true,
        hasDefault: Boolean(defaultValue) || useRandomDefault,
        ...(useRandomDefault
          ? {
              useRandomDefault: true,
              randomDefaultLength: normalizeRandomDefaultLength(raw.randomDefaultLength),
              randomDefaultSpecialChars: raw.randomDefaultSpecialChars === true,
            }
          : {}),
      });

      if (defaultValue) {
        sanitizedDefaults[key] = defaultValue;
      }
    }

    for (const [key, value] of Object.entries(defaultValues ?? {})) {
      if (!seenKeys.has(key) && value?.trim()) {
        throw new BadRequestException(`Default value provided for unknown environment variable key: ${key}`);
      }
    }

    return { environmentVariables, envDefaultValues: sanitizedDefaults };
  }

  validateProvisioningPayload(payload: CloudInitProvisioningPayload): void {
    const mode = payload.provisioningMode ?? 'simple';
    const envKeys = payload.environmentVariables.map((variable) => variable.key);

    let workDir: string;

    try {
      workDir = validateCloudInitWorkDir(payload.workDir);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }

    const sampleContext: CloudInitTemplateContext = {
      ...SAMPLE_TEMPLATE_CONTEXT,
      workDir,
      dockerImage: payload.dockerImage?.trim() || SAMPLE_TEMPLATE_CONTEXT.dockerImage,
      containerPort: payload.containerPort ?? SAMPLE_TEMPLATE_CONTEXT.containerPort,
      hostPort: payload.hostPort ?? SAMPLE_TEMPLATE_CONTEXT.hostPort,
      environment: Object.fromEntries(envKeys.map((key) => [key, 'sample-value'])),
    };

    if (mode === 'simple') {
      if (!payload.dockerImage?.trim()) {
        throw new BadRequestException('Docker image is required when provisioning mode is simple');
      }

      return;
    }

    if (mode === 'compose-template') {
      const composeTemplate = payload.dockerComposeTemplate?.trim();

      if (!composeTemplate) {
        throw new BadRequestException('Docker compose template is required when provisioning mode is compose-template');
      }

      try {
        interpolateCloudInitTemplate(composeTemplate, sampleContext, envKeys, 'yaml');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid docker compose template';

        throw new BadRequestException(message);
      }

      return;
    }

    const userDataTemplate = payload.userDataTemplate?.trim();

    if (!userDataTemplate) {
      throw new BadRequestException('User data template is required when provisioning mode is user-data-template');
    }

    try {
      interpolateCloudInitTemplate(userDataTemplate, sampleContext, envKeys, 'shell');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid user data template';

      throw new BadRequestException(message);
    }
  }

  resolveEnvironmentVariables(
    config: CloudInitConfigEntity,
    requestedEnv?: Record<string, unknown>,
  ): Record<string, string> {
    const declaredKeys = new Set((config.environmentVariables ?? []).map((def) => def.key));
    const defaults = config.envDefaultValues ?? {};
    const resolved: Record<string, string> = {};

    for (const def of config.environmentVariables ?? []) {
      const defaultValue = defaults[def.key]?.trim();

      if (defaultValue) {
        resolved[def.key] = defaultValue;
      }
    }

    for (const [key, value] of Object.entries(requestedEnv ?? {})) {
      if (!declaredKeys.has(key)) {
        throw new BadRequestException(`Unknown environment variable key: ${key}`);
      }

      if (value === undefined || value === null) {
        continue;
      }

      const strValue = String(value).trim();

      if (strValue.length > 0) {
        resolved[key] = strValue;
      }
    }

    for (const def of config.environmentVariables ?? []) {
      const currentValue = resolved[def.key];

      if ((!currentValue || currentValue.trim().length === 0) && def.useRandomDefault) {
        resolved[def.key] = generateSecureRandomString(
          normalizeRandomDefaultLength(def.randomDefaultLength),
          def.randomDefaultSpecialChars === true,
        );
      }
    }

    const missing: string[] = [];

    for (const def of config.environmentVariables ?? []) {
      const value = resolved[def.key];

      if (!value || value.trim().length === 0) {
        missing.push(def.key);
      }
    }

    if (missing.length > 0) {
      throw new BadRequestException(`Missing required environment variables: ${missing.join(', ')}`);
    }

    return resolved;
  }

  async findByIdForProvisioning(id: string): Promise<CloudInitConfigEntity> {
    const config = await this.cloudInitConfigsRepository.findByIdOrThrow(id);

    if (!config.isActive) {
      throw new BadRequestException(`CloudInit config ${id} is not active`);
    }

    return config;
  }

  getOrderFields(config: CloudInitConfigEntity): CloudInitConfigOrderFieldDto[] {
    return (config.environmentVariables ?? [])
      .filter((def) => def.showInOrderForm)
      .map((def) => ({
        key: def.key,
        label: def.label,
        description: def.description ?? null,
        required: !def.hasDefault,
        hasDefault: def.hasDefault === true,
      }));
  }

  async getOrderFieldsForPlan(planId: string, cloudInitConfigId: string): Promise<CloudInitConfigOrderFieldDto[]> {
    const plan = await this.servicePlansRepository.findByIdOrThrow(planId);
    const allowedConfigIds = collectCustomCloudInitConfigIdsFromPlanDefaults(plan.providerConfigDefaults);

    if (!allowedConfigIds.includes(cloudInitConfigId)) {
      throw new NotFoundException(`CloudInit config with ID ${cloudInitConfigId} not found`);
    }

    const config = await this.cloudInitConfigsRepository.findByIdOrThrow(cloudInitConfigId);

    if (!config.isActive) {
      throw new NotFoundException(`CloudInit config with ID ${cloudInitConfigId} not found`);
    }

    return this.getOrderFields(config);
  }

  async assertNotReferencedByActivePlans(cloudInitConfigId: string): Promise<void> {
    const referencing: string[] = [];
    let offset = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const plans = await this.servicePlansRepository.findAll(SERVICE_PLAN_REFERENCE_BATCH_SIZE, offset);
      const batchMatches = plans.filter((plan) => {
        if (!plan.isActive) {
          return false;
        }

        const defaults = plan.providerConfigDefaults;

        if (!defaults) {
          return false;
        }

        if (defaults['cloudInitConfigId'] === cloudInitConfigId) {
          return true;
        }

        const legacyIds = defaults['cloudInitConfigIds'];

        if (Array.isArray(legacyIds) && legacyIds.includes(cloudInitConfigId)) {
          return true;
        }

        return collectCustomCloudInitConfigIdsFromPlanDefaults(defaults).includes(cloudInitConfigId);
      });

      referencing.push(...batchMatches.map((plan) => plan.id));

      if (plans.length < SERVICE_PLAN_REFERENCE_BATCH_SIZE) {
        break;
      }

      offset += SERVICE_PLAN_REFERENCE_BATCH_SIZE;
    }

    if (referencing.length > 0) {
      throw new BadRequestException(
        `CloudInit config is referenced by ${referencing.length} active service plan(s) and cannot be deleted`,
      );
    }
  }

  async buildOrderProvisioningOptions(
    providerConfigDefaults: Record<string, unknown> | undefined,
  ): Promise<OrderProvisioningOptionDto[]> {
    const options = resolvePlanProvisioningOptions(providerConfigDefaults);
    const result: OrderProvisioningOptionDto[] = [];

    for (const option of options) {
      if (option.type === 'integrated') {
        result.push({
          optionKey: encodeProvisioningOptionKey(option),
          type: 'integrated',
          service: option.service,
          label: option.service === 'controller' ? 'Agenstra Controller' : 'Agenstra Manager',
          description:
            option.service === 'controller' ? 'Runs the full agent controller stack.' : 'Runs the agent manager only.',
        });
        continue;
      }

      const config = await this.cloudInitConfigsRepository.findByIdOrThrow(option.cloudInitConfigId);

      if (!config.isActive) {
        throw new BadRequestException(`CloudInit config ${option.cloudInitConfigId} is not active`);
      }

      result.push({
        optionKey: encodeProvisioningOptionKey(option),
        type: 'custom',
        cloudInitConfigId: option.cloudInitConfigId,
        label: config.name,
        description: config.description ?? null,
      });
    }

    if (options.length > 0 && result.length === 0) {
      throw new BadRequestException('No active provisioning options are available for this plan');
    }

    return result;
  }

  /**
   * Ensures plan defaults reference at least one valid provisioning option for provisionable service types.
   * Uses tenant-scoped repository lookup; cross-tenant ids are rejected as not found.
   */
  async assertActiveConfigForPlanDefaults(
    serviceTypeId: string,
    providerConfigDefaults: Record<string, unknown> | undefined,
  ): Promise<void> {
    const options = parsePlanProvisioningOptions(providerConfigDefaults);
    const serviceType = await this.serviceTypesRepository.findByIdOrThrow(serviceTypeId);
    const requiresProvisioning = serviceType.provider === 'hetzner' || serviceType.provider === 'digital-ocean';

    if (requiresProvisioning && options.length === 0) {
      throw new BadRequestException('At least one provisioning option is required for this service type');
    }

    if (options.length === 0) {
      return;
    }

    await this.assertActiveProvisioningOptions(options);
  }

  private async assertActiveProvisioningOptions(options: PlanProvisioningOption[]): Promise<void> {
    if (options.length === 0) {
      throw new BadRequestException('At least one provisioning option is required');
    }

    for (const option of options) {
      if (option.type === 'custom') {
        await this.assertActiveCustomConfig(option.cloudInitConfigId);
      }
    }
  }

  private async assertActiveCustomConfig(cloudInitConfigId: string): Promise<void> {
    const config = await this.cloudInitConfigsRepository.findByIdOrThrow(cloudInitConfigId);

    if (!config.isActive) {
      throw new BadRequestException(`CloudInit config ${cloudInitConfigId} is not active`);
    }
  }
}
