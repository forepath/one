import { CloudInitConfigEntity } from '../../entities/cloud-init-config.entity';
import { formatEnvLines, quoteYamlScalar } from './env.utils';
import {
  DEFAULT_COMPOSE_TEMPLATE,
  interpolateCloudInitTemplate,
  type CloudInitTemplateContext,
} from './template-interpolation.utils';
import { quoteShellLiteral, validateCloudInitWorkDir } from './work-dir.utils';

export interface CustomConfigurationCloudInitConfig {
  ssh: {
    publicKey: string;
  };
  host: {
    hostname: string;
    fqdn: string;
  };
  app: {
    dockerImage: string;
    containerPort: number;
    hostPort: number;
    workDir: string;
    environment: Record<string, string>;
  };
}

export function buildCustomConfigurationCloudInitConfigFromRequest(
  template: CloudInitConfigEntity,
  resolvedEnv: Record<string, string>,
  effectiveConfig: Record<string, unknown>,
  hostname: string,
  baseDomain = 'spirde.com',
): CustomConfigurationCloudInitConfig {
  return {
    ssh: {
      publicKey: (effectiveConfig.sshPublicKey as string) ?? '',
    },
    host: {
      hostname,
      fqdn: `${hostname}.${baseDomain}`,
    },
    app: {
      dockerImage: template.dockerImage?.trim() ?? '',
      containerPort: template.containerPort ?? 8080,
      hostPort: template.hostPort ?? 80,
      workDir: validateCloudInitWorkDir(template.workDir),
      environment: resolvedEnv,
    },
  };
}

function buildTemplateContext(
  template: CloudInitConfigEntity,
  config: CustomConfigurationCloudInitConfig,
): CloudInitTemplateContext {
  return {
    hostname: config.host.hostname,
    fqdn: config.host.fqdn,
    workDir: config.app.workDir,
    sshPublicKey: config.ssh.publicKey,
    dockerImage: config.app.dockerImage,
    containerPort: config.app.containerPort,
    hostPort: config.app.hostPort,
    environment: config.app.environment,
  };
}

function buildDockerCompose(config: CustomConfigurationCloudInitConfig): string {
  const envLines = Object.entries(config.app.environment).map(([key, value]) => `${key}: ${value}`);
  const formattedEnv = formatEnvLines(envLines);

  return `services:
  app:
    image: ${quoteYamlScalar(config.app.dockerImage)}
    container_name: custom-app
    restart: unless-stopped
    ports:
      - "${config.app.hostPort}:${config.app.containerPort}"
    environment:
${formattedEnv || '      # no environment variables'}
`;
}

function resolveDockerComposeYaml(template: CloudInitConfigEntity, config: CustomConfigurationCloudInitConfig): string {
  const mode = template.provisioningMode ?? 'simple';
  const allowedEnvKeys = (template.environmentVariables ?? []).map((variable) => variable.key);
  const context = buildTemplateContext(template, config);

  if (mode === 'compose-template') {
    const composeTemplate = template.dockerComposeTemplate?.trim() || DEFAULT_COMPOSE_TEMPLATE;

    return interpolateCloudInitTemplate(composeTemplate, context, allowedEnvKeys, 'yaml');
  }

  return buildDockerCompose(config);
}

function buildBootstrapUserDataScript(config: CustomConfigurationCloudInitConfig, dockerCompose: string): string {
  const workDir = quoteShellLiteral(config.app.workDir);
  const sshConfig = `Port 22
ListenAddress 0.0.0.0
PermitRootLogin yes
PasswordAuthentication no
KbdInteractiveAuthentication no
UsePAM yes
X11Forwarding yes
PrintMotd no
AcceptEnv LANG LC_*
Subsystem       sftp    /usr/lib/openssh/sftp-server
`;

  return `#!/bin/bash
set -euo pipefail

log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*" | tee -a /var/log/custom-app-provisioning.log
}

log "Starting custom configuration provisioning script (cloud-init user-data)"

for i in {1..10}; do
    if ping -c 1 -W 2 8.8.8.8 > /dev/null 2>&1; then
        log "Network is ready"
        break
    fi
    if [ $i -eq 10 ]; then
        log "WARNING: Network connectivity check failed, continuing anyway"
    fi
    sleep 1
done

export DEBIAN_FRONTEND=noninteractive
log "Updating system packages..."
apt-get update -qq
apt-get upgrade -y -qq

log "Installing openssh server..."
apt-get install -y openssh-server ssh

log "Adding SSH public key..."
mkdir -p /root/.ssh
echo "${config.ssh?.publicKey ?? ''}" > /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys

log "Configuring SSH server..."
cat > /etc/ssh/sshd_config <<'EOF'
${sshConfig}
EOF
service ssh restart

log "Installing prerequisites for Docker installation..."
apt-get update -qq
apt-get install -y ca-certificates curl

log "Installing Docker using convenience script..."
curl -fsSL https://get.docker.com -o get-docker.sh
sh ./get-docker.sh
rm -f get-docker.sh

log "Starting Docker service..."
systemctl enable docker
systemctl start docker

log "Waiting for Docker to be ready..."
for i in {1..30}; do
    if docker info > /dev/null 2>&1; then
        log "Docker is ready"
        break
    fi
    if [ $i -eq 30 ]; then
        log "ERROR: Docker failed to start after 30 attempts"
        exit 1
    fi
    sleep 2
done

log "Creating application directory..."
mkdir -p ${workDir}

log "Creating docker-compose.yaml file..."
cat > ${workDir}/docker-compose.yaml <<'EOF'
${dockerCompose}
EOF

log "Starting application container..."
cd ${workDir}
docker compose up -d || {
    log "ERROR: Failed to start application container"
    docker compose logs || true
    exit 1
}

log "Custom configuration provisioning completed successfully at $(date)"
`;
}

export function buildCustomConfigurationCloudInitUserData(
  template: CloudInitConfigEntity,
  config: CustomConfigurationCloudInitConfig,
): string {
  const mode = template.provisioningMode ?? 'simple';

  if (mode === 'user-data-template') {
    const allowedEnvKeys = (template.environmentVariables ?? []).map((variable) => variable.key);
    const context = buildTemplateContext(template, config);
    const userDataTemplate = template.userDataTemplate?.trim();

    if (!userDataTemplate) {
      throw new Error('User data template is required for user-data-template provisioning mode');
    }

    const script = interpolateCloudInitTemplate(userDataTemplate, context, allowedEnvKeys, 'shell');

    return Buffer.from(script).toString('base64');
  }

  const dockerCompose = resolveDockerComposeYaml(template, config);
  const script = buildBootstrapUserDataScript(config, dockerCompose);

  return Buffer.from(script).toString('base64');
}
