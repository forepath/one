import { randomBytes } from 'crypto';

import { buildCertbotBootstrapScript } from './certbot-bootstrap.script';
import { formatEnvLines, quoteYamlScalar } from './env.utils';

export interface AgentManagerCloudInitConfig {
  ssh: {
    publicKey: string;
  };
  host: {
    hostname: string;
    /** Fully qualified domain name for SSL and CORS */
    fqdn: string;
  };
  proxy: {
    httpPort: number;
    httpsPort: number;
    websocketPort: number;
  };
  backend: {
    host: string;
    port: number;
    websocketPort: number;
    websocketNamespace?: string;
    nodeEnv: string;
    database?: {
      host: string;
      port: number;
      username: string;
      password: string;
      database: string;
    };
    /** Manager supports only api-key or keycloak; not users */
    authentication: {
      authenticationMethod: 'api-key' | 'keycloak';
      staticApiKey?: string;
      keycloak?: {
        serverUrl: string;
        authServerUrl: string;
        realm: string;
        clientId: string;
        clientSecret: string;
      };
    };
    encryption: {
      encryptionKey: string;
      /** JWT signing secret for local auth features (same generation as agent-controller provisioning). */
      jwtSecret: string;
    };
    smtp: {
      host: string;
      port: number;
      user: string;
      password: string;
      from: string;
    };
    cors: {
      origin: string;
    };
    /** Git configuration for agent-manager (optional). Passed as GIT_* env vars. */
    git?: {
      setupMode?: 'clone' | 'empty';
      repositoryUrl?: string;
      username?: string;
      token?: string;
      password?: string;
      privateKey?: string;
      commitAuthorName?: string;
      commitAuthorEmail?: string;
    };
    /** Cursor API key for agent-manager (optional). Passed as CURSOR_API_KEY env var. */
    cursorApiKey?: string;
  };
}

/**
 * Builds AgentManagerCloudInitConfig from effectiveConfig (plan defaults + requestedConfig) and hostname.
 * Generates random encryptionKey and jwtSecret. Manager does not support 'users' auth: if
 * authenticationMethod is 'users', it is coerced to 'api-key'.
 * Does not read disableSignup or provisioning tokens (hetznerApiToken, digitaloceanApiToken).
 *
 * @param baseDomain - Base domain for FQDN (e.g. spirde.com). Defaults to spirde.com.
 */
export function buildAgentManagerCloudInitConfigFromRequest(
  effectiveConfig: Record<string, unknown>,
  hostname: string,
  baseDomain = 'spirde.com',
): AgentManagerCloudInitConfig {
  const encryptionKey = randomBytes(32).toString('base64');
  const jwtSecret = randomBytes(32).toString('hex');
  const fqdn = `${hostname}.${baseDomain}`;
  const smtp = effectiveConfig.smtp as Record<string, unknown> | undefined;
  const keycloak = effectiveConfig.keycloak as Record<string, unknown> | undefined;
  const git = effectiveConfig.git as Record<string, unknown> | undefined;
  let authMethod = (effectiveConfig.authenticationMethod as string) ?? 'api-key';

  if (authMethod === 'users') {
    authMethod = 'api-key';
  }

  if (authMethod !== 'api-key' && authMethod !== 'keycloak') {
    authMethod = 'api-key';
  }

  return {
    ssh: {
      publicKey: (effectiveConfig.sshPublicKey as string) ?? '',
    },
    host: { hostname, fqdn },
    proxy: {
      httpPort: 80,
      httpsPort: 443,
      websocketPort: 8443,
    },
    backend: {
      host: '0.0.0.0',
      port: 3000,
      websocketPort: 8080,
      websocketNamespace: 'websocket',
      nodeEnv: 'production',
      database: {
        host: 'postgres',
        port: 5432,
        username: 'postgres',
        password: 'postgres',
        database: 'postgres',
      },
      authentication: {
        authenticationMethod: authMethod as 'api-key' | 'keycloak',
        staticApiKey: (effectiveConfig.staticApiKey as string) ?? '',
        ...(keycloak && {
          keycloak: {
            serverUrl: (keycloak.serverUrl as string) ?? '',
            authServerUrl: (keycloak.authServerUrl as string) ?? '',
            realm: (keycloak.realm as string) ?? '',
            clientId: (keycloak.clientId as string) ?? '',
            clientSecret: (keycloak.clientSecret as string) ?? '',
          },
        }),
      },
      encryption: { encryptionKey, jwtSecret },
      smtp: {
        host: (smtp?.host as string) ?? 'mailhog',
        port: (smtp?.port as number) ?? 1025,
        user: (smtp?.user as string) ?? '',
        password: (smtp?.password as string) ?? '',
        from: (smtp?.from as string) ?? 'noreply@localhost',
      },
      // Open by default; restrict via CORS_ORIGIN on the provisioned host (compose/env) if needed.
      cors: { origin: '*' },
      ...(git !== undefined && {
        git: {
          setupMode: (git.setupMode as string) === 'empty' ? 'empty' : 'clone',
          repositoryUrl: (git.repositoryUrl as string) ?? '',
          username: (git.username as string) ?? '',
          token: (git.token as string) ?? '',
          password: (git.password as string) ?? '',
          privateKey: (git.privateKey as string) ?? '',
          commitAuthorName: (git.commitAuthorName as string) ?? '',
          commitAuthorEmail: (git.commitAuthorEmail as string) ?? '',
        },
      }),
      ...((effectiveConfig.cursorApiKey as string)?.trim()
        ? { cursorApiKey: (effectiveConfig.cursorApiKey as string).trim() }
        : {}),
    },
  };
}

export function buildAgentManagerCloudInitUserData(config: AgentManagerCloudInitConfig): string {
  const backendEnv = formatEnvLines([
    `HOST: ${config.backend?.host ?? '0.0.0.0'}`,
    `PORT: ${config.backend?.port ?? '3000'}`,
    `WEBSOCKET_PORT: ${config.backend?.websocketPort ?? '8080'}`,
    `NODE_ENV: ${config.backend?.nodeEnv ?? 'production'}`,
    `DB_HOST: ${config.backend?.database?.host ?? 'postgres'}`,
    `DB_PORT: ${config.backend?.database?.port ?? '5432'}`,
    `DB_USERNAME: ${config.backend?.database?.username ?? 'postgres'}`,
    `DB_PASSWORD: ${config.backend?.database?.password ?? 'postgres'}`,
    `DB_DATABASE: ${config.backend?.database?.database ?? 'postgres'}`,
    `AUTHENTICATION_METHOD: ${config.backend?.authentication?.authenticationMethod ?? 'api-key'}`,
    `STATIC_API_KEY: ${config.backend?.authentication?.staticApiKey ?? ''}`,
    `KEYCLOAK_SERVER_URL: ${config.backend?.authentication?.keycloak?.serverUrl ?? ''}`,
    `KEYCLOAK_AUTH_SERVER_URL: ${config.backend?.authentication?.keycloak?.authServerUrl ?? ''}`,
    `KEYCLOAK_REALM: ${config.backend?.authentication?.keycloak?.realm ?? ''}`,
    `KEYCLOAK_CLIENT_ID: ${config.backend?.authentication?.keycloak?.clientId ?? ''}`,
    `KEYCLOAK_CLIENT_SECRET: ${config.backend?.authentication?.keycloak?.clientSecret ?? ''}`,
    `ENCRYPTION_KEY: ${config.backend?.encryption?.encryptionKey ?? ''}`,
    `JWT_SECRET: ${config.backend?.encryption?.jwtSecret ?? ''}`,
    `SMTP_HOST: ${config.backend?.smtp?.host ?? 'mailhog'}`,
    `SMTP_PORT: ${config.backend?.smtp?.port ?? '1025'}`,
    `SMTP_USER: ${config.backend?.smtp?.user ?? ''}`,
    `SMTP_PASSWORD: ${config.backend?.smtp?.password ?? ''}`,
    `EMAIL_FROM: ${config.backend?.smtp?.from ?? 'noreply@localhost'}`,
    `CORS_ORIGIN: ${config.backend?.cors?.origin ?? ''}`,
    ...(config.backend?.cursorApiKey?.trim() ? [`CURSOR_API_KEY: ${config.backend.cursorApiKey.trim()}`] : []),
    ...(config.backend?.git
      ? [
          ...(config.backend.git.setupMode === 'empty'
            ? [`GIT_REPOSITORY_SETUP_MODE: empty`]
            : [
                ...(config.backend.git.setupMode === 'clone' ? [`GIT_REPOSITORY_SETUP_MODE: clone`] : []),
                ...(config.backend.git.repositoryUrl
                  ? [`GIT_REPOSITORY_URL: ${config.backend.git.repositoryUrl}`]
                  : []),
                ...(config.backend.git.username ? [`GIT_USERNAME: ${config.backend.git.username}`] : []),
                ...(config.backend.git.token ? [`GIT_TOKEN: ${config.backend.git.token}`] : []),
                ...(config.backend.git.password ? [`GIT_PASSWORD: ${config.backend.git.password}`] : []),
                ...(config.backend.git.privateKey ? [`GIT_PRIVATE_KEY: ${config.backend.git.privateKey}`] : []),
                ...(config.backend.git.commitAuthorName
                  ? [`GIT_COMMIT_AUTHOR_NAME: ${config.backend.git.commitAuthorName}`]
                  : []),
                ...(config.backend.git.commitAuthorEmail
                  ? [`GIT_COMMIT_AUTHOR_EMAIL: ${config.backend.git.commitAuthorEmail}`]
                  : []),
              ]),
        ]
      : []),
  ]);
  const dockerCompose = `services:
  postgres:
    image: postgres:16-alpine
    container_name: agent-manager-postgres
    environment:
      POSTGRES_USER: ${quoteYamlScalar(config.backend?.database?.username ?? 'postgres')}
      POSTGRES_PASSWORD: ${quoteYamlScalar(config.backend?.database?.password ?? 'postgres')}
      POSTGRES_DB: ${quoteYamlScalar(config.backend?.database?.database ?? 'postgres')}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U ${config.backend?.database?.username ?? 'postgres'}']
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - agent-manager-network
    restart: unless-stopped

  backend-agent-manager:
    image: ghcr.io/forepath/agenstra-manager-api:latest
    pull_policy: always
    container_name: agent-manager-api
    environment:
${backendEnv}
    ports:
      - '${config.backend?.port ?? '3000'}:${config.backend?.port ?? '3000'}'
      - '${config.backend?.websocketPort ?? '8080'}:${config.backend?.websocketPort ?? '8080'}'
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    depends_on:
      postgres:
        condition: service_healthy
    networks:
      - agent-manager-network
    restart: unless-stopped

  nginx:
    image: nginx:alpine
    container_name: agent-manager-nginx
    ports:
      - '${config.proxy?.httpPort ?? '80'}:${config.proxy?.httpPort ?? '80'}'
      - '${config.proxy?.httpsPort ?? '443'}:${config.proxy?.httpsPort ?? '443'}'
      - '${config.proxy?.websocketPort ?? '8443'}:${config.proxy?.websocketPort ?? '8443'}'
    volumes:
      - /opt/agent-manager/sites-enabled:/etc/nginx/conf.d:ro
      - /opt/agent-manager/ssl:/etc/nginx/ssl:ro
      - /opt/agent-manager/certbot-webroot:/var/www/certbot:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro
    depends_on:
      - backend-agent-manager
    networks:
      - agent-manager-network
    restart: unless-stopped

volumes:
  postgres_data:

networks:
  agent-manager-network:
    driver: bridge
`;
  const nginxBootstrapConfig = `
server {
    listen ${config.proxy?.httpPort ?? '80'};
    server_name ${config.host?.fqdn ?? config.host?.hostname ?? 'localhost'};

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/certbot;
        default_type "text/plain";
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen ${config.proxy?.httpsPort ?? '443'} ssl http2;
    server_name ${config.host?.fqdn ?? config.host?.hostname ?? 'localhost'};

    ssl_certificate /etc/nginx/ssl/bootstrap.crt;
    ssl_certificate_key /etc/nginx/ssl/bootstrap.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    location / {
        proxy_pass http://agent-manager-api:${config.backend?.port ?? '3000'};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /${config.backend?.websocketNamespace ?? 'websocket'} {
        proxy_pass http://agent-manager-api:${config.backend?.websocketPort ?? '8080'};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    location /socket.io/ {
        proxy_pass http://agent-manager-api:${config.backend?.websocketPort ?? '8080'};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
`;
  const nginxLetsEncryptConfig = `
server {
    listen ${config.proxy?.httpPort ?? '80'};
    server_name ${config.host?.fqdn ?? config.host?.hostname ?? 'localhost'};

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/certbot;
        default_type "text/plain";
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen ${config.proxy?.httpsPort ?? '443'} ssl http2;
    server_name ${config.host?.fqdn ?? config.host?.hostname ?? 'localhost'};

    ssl_certificate /etc/letsencrypt/live/${config.host?.fqdn ?? config.host?.hostname ?? 'localhost'}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${config.host?.fqdn ?? config.host?.hostname ?? 'localhost'}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    location / {
        proxy_pass http://agent-manager-api:${config.backend?.port ?? '3000'};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /${config.backend?.websocketNamespace ?? 'websocket'} {
        proxy_pass http://agent-manager-api:${config.backend?.websocketPort ?? '8080'};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    location /socket.io/ {
        proxy_pass http://agent-manager-api:${config.backend?.websocketPort ?? '8080'};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
`;
  const sshConfig = `
Include /etc/ssh/sshd_config.d/*.conf
PermitRootLogin yes
PasswordAuthentication no
KbdInteractiveAuthentication no
UsePAM yes
X11Forwarding yes
PrintMotd no
AcceptEnv LANG LC_*
Subsystem       sftp    /usr/lib/openssh/sftp-server
`;
  const script = `#!/bin/bash
set -euo pipefail

# Cloud-init user-data script for agent-manager provisioning
# This script is executed by cloud-init during server initialization

log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*" | tee -a /var/log/agent-manager-provisioning.log
}

log "Starting server provisioning script (cloud-init user-data)"

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

# Install openssh server
log "Installing openssh server..."
apt-get install -y openssh-server ssh

# Add SSH public key
log "Adding SSH public key..."
mkdir -p /root/.ssh
echo "${config.ssh?.publicKey ?? ''}" > /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys

# Configure SSH server
log "Configuring SSH server..."
cat > /etc/ssh/sshd_config <<'EOF'
${sshConfig}
EOF
service ssh restart

# Set SSH password permanently
log "Setting SSH password permanently..."
chage -d 1 -m 0 -M 99999 -I -1 -E -1 root

# Install Docker using the convenience script
# Official method: https://docs.docker.com/engine/install/ubuntu/#install-using-the-convenience-script
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

if ! docker info > /dev/null 2>&1; then
    log "ERROR: Docker is not working properly"
    exit 1
fi

# Create directory for agent-manager
log "Creating agent-manager directory..."
mkdir -p /opt/agent-manager

# Create nginx sites-enabled directory
log "Creating nginx sites-enabled directory..."
mkdir -p /opt/agent-manager/sites-enabled

log "Creating nginx configuration file..."
cat > /opt/agent-manager/sites-enabled/default.conf <<'EOF'
${nginxBootstrapConfig}
EOF

# Create nginx ssl directory
log "Creating nginx ssl directory..."
mkdir -p /opt/agent-manager/ssl

# Generate bootstrap SSL certificate for nginx before Let's Encrypt is available
log "Generating bootstrap SSL certificate..."
mkdir -p /opt/agent-manager/ssl
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout /opt/agent-manager/ssl/bootstrap.key \
    -out /opt/agent-manager/ssl/bootstrap.crt \
    -subj "/C=DE/ST=Nordrhein-Westfalen/L=Herford/O=Agenstra/CN=${config.host?.fqdn ?? config.host?.hostname ?? 'localhost'}" \
    -addext "subjectAltName=DNS:${config.host?.fqdn ?? config.host?.hostname ?? 'localhost'}" 2>/dev/null || {
    log "WARNING: Failed to generate bootstrap SSL certificate, nginx may not start properly"
}

chmod 600 /opt/agent-manager/ssl/bootstrap.key
chmod 644 /opt/agent-manager/ssl/bootstrap.crt

# Create docker-compose.yaml file
log "Creating docker-compose.yaml file..."
cat > /opt/agent-manager/docker-compose.yaml <<'EOF'
${dockerCompose}
EOF

# Start agent-manager container
log "Starting agent-manager container..."
cd /opt/agent-manager
docker compose up -d || {
    log "ERROR: Failed to start agent-manager container"
    docker compose logs || true
    exit 1
}

${buildCertbotBootstrapScript({
  stackName: 'agent-manager',
  stackDir: '/opt/agent-manager',
  nginxContainerName: 'agent-manager-nginx',
  fqdn: config.host?.fqdn ?? config.host?.hostname ?? 'localhost',
  letsEncryptEmail: process.env.LETS_ENCRYPT_EMAIL,
  letsEncryptNginxConfig: nginxLetsEncryptConfig,
})}

log "agent-manager provisioning completed successfully at $(date)"
`;

  return Buffer.from(script).toString('base64');
}

const AGENT_MANAGER_UPDATE_LOG = '/var/log/agent-manager-update.log';

/**
 * Builds the shell command to run on a provisioned agent-manager host to pull latest images
 * and recreate containers (docker compose up -d --pull=always). Logs to agent-manager-update.log.
 * Use when executing updates over SSH from the billing scheduler.
 */
export function buildAgentManagerUpdateCommand(): string {
  return `log() { echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*" | tee -a ${AGENT_MANAGER_UPDATE_LOG}; }; log "Starting update"; cd /opt/agent-manager && docker compose up -d --pull=always 2>&1 | tee -a ${AGENT_MANAGER_UPDATE_LOG} || { log "ERROR: Update failed"; exit 1; }; log "Update completed"`;
}
