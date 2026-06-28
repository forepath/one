import { quoteYamlScalar } from './env.utils';
import type { CloudInitProvisioningMode } from '../../entities/cloud-init-config.entity';

export type { CloudInitProvisioningMode };

export interface CloudInitTemplateContext {
  hostname: string;
  fqdn: string;
  workDir: string;
  sshPublicKey: string;
  dockerImage: string;
  containerPort: number;
  hostPort: number;
  environment: Record<string, string>;
}

const BUILTIN_PLACEHOLDERS: Record<string, (context: CloudInitTemplateContext) => string> = {
  HOSTNAME: (context) => context.hostname,
  FQDN: (context) => context.fqdn,
  WORK_DIR: (context) => context.workDir,
  SSH_PUBLIC_KEY: (context) => context.sshPublicKey,
  DOCKER_IMAGE: (context) => context.dockerImage,
  CONTAINER_PORT: (context) => String(context.containerPort),
  HOST_PORT: (context) => String(context.hostPort),
};

const PLACEHOLDER_PATTERN = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;
const ENV_PLACEHOLDER_PATTERN = /\{\{env\.([A-Z][A-Z0-9_]*)\}\}/g;
const UNRESOLVED_PLACEHOLDER_PATTERN = /\{\{[^}]+\}\}/;

function formatEnvValueForTemplate(value: string, envValueFormat: 'yaml' | 'shell'): string {
  if (envValueFormat === 'yaml') {
    return quoteYamlScalar(value);
  }

  if (value === '') {
    return "''";
  }

  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

const SHELL_QUOTED_BUILTIN_PLACEHOLDERS = new Set(['WORK_DIR', 'SSH_PUBLIC_KEY']);

function formatBuiltinValueForTemplate(
  placeholderName: string,
  value: string,
  envValueFormat: 'yaml' | 'shell',
): string {
  if (envValueFormat !== 'shell' || !SHELL_QUOTED_BUILTIN_PLACEHOLDERS.has(placeholderName)) {
    return value;
  }

  return formatEnvValueForTemplate(value, 'shell');
}

export function interpolateCloudInitTemplate(
  template: string,
  context: CloudInitTemplateContext,
  allowedEnvKeys: string[],
  envValueFormat: 'yaml' | 'shell' = 'yaml',
): string {
  const allowedEnvKeySet = new Set(allowedEnvKeys);

  let rendered = template.replace(PLACEHOLDER_PATTERN, (_match, name: string) => {
    const resolver = BUILTIN_PLACEHOLDERS[name];

    if (!resolver) {
      throw new Error(`Unknown template placeholder: {{${name}}}`);
    }

    return formatBuiltinValueForTemplate(name, resolver(context), envValueFormat);
  });

  rendered = rendered.replace(ENV_PLACEHOLDER_PATTERN, (_match, envKey: string) => {
    if (!allowedEnvKeySet.has(envKey)) {
      throw new Error(`Unknown environment placeholder: {{env.${envKey}}}`);
    }

    const value = context.environment[envKey] ?? '';

    return formatEnvValueForTemplate(value, envValueFormat);
  });

  if (UNRESOLVED_PLACEHOLDER_PATTERN.test(rendered)) {
    throw new Error('Template contains unresolved placeholders after interpolation');
  }

  return rendered;
}

export const DEFAULT_COMPOSE_TEMPLATE = `services:
  app:
    image: {{DOCKER_IMAGE}}
    container_name: custom-app
    restart: unless-stopped
    ports:
      - "{{HOST_PORT}}:{{CONTAINER_PORT}}"
    environment: {}
`;

export const DEFAULT_USER_DATA_TEMPLATE = `#!/bin/bash
set -euo pipefail

log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*" | tee -a /var/log/custom-app-provisioning.log
}

log "Provisioning {{HOSTNAME}} ({{FQDN}})"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y openssh-server ca-certificates curl

mkdir -p /root/.ssh
echo "{{SSH_PUBLIC_KEY}}" > /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys

curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker

mkdir -p {{WORK_DIR}}
cat > {{WORK_DIR}}/docker-compose.yaml <<'EOF'
services:
  app:
    image: {{DOCKER_IMAGE}}
    container_name: custom-app
    restart: unless-stopped
    ports:
      - "{{HOST_PORT}}:{{CONTAINER_PORT}}"
    environment: {}
EOF

cd {{WORK_DIR}}
docker compose up -d

log "Provisioning completed"
`;
