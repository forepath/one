interface CertbotBootstrapScriptOptions {
  stackName: string;
  stackDir: string;
  nginxContainerName: string;
  fqdn: string;
  letsEncryptEmail?: string;
  letsEncryptNginxConfig: string;
}

export function buildCertbotBootstrapScript(options: CertbotBootstrapScriptOptions): string {
  const { stackName, stackDir, nginxContainerName, fqdn, letsEncryptEmail, letsEncryptNginxConfig } = options;
  const emailArgs = letsEncryptEmail?.trim()
    ? `--email "${letsEncryptEmail.trim()}"`
    : '--register-unsafely-without-email';

  return `
# Install dependencies for Certbot (pip-based installation, per official docs)
log "Installing dependencies for Certbot..."
apt-get install -y python3 python3-dev python3-venv libaugeas-dev gcc openssl
apt-get remove -y certbot || true

log "Installing Certbot in Python virtual environment..."
python3 -m venv /opt/certbot
/opt/certbot/bin/pip install --upgrade pip
/opt/certbot/bin/pip install certbot certbot-nginx
ln -sf /opt/certbot/bin/certbot /usr/local/bin/certbot

log "Preparing Certbot webroot for ${stackName}..."
mkdir -p ${stackDir}/certbot-webroot

FQDN="${fqdn}"
INSTANCE_PUBLIC_IP="$(curl -fsS -m 5 http://169.254.169.254/hetzner/v1/metadata/public-ipv4 2>/dev/null || true)"
if [ -z "$INSTANCE_PUBLIC_IP" ]; then
    INSTANCE_PUBLIC_IP="$(curl -4fsS -m 5 https://ifconfig.me 2>/dev/null || true)"
fi

if [ -n "$INSTANCE_PUBLIC_IP" ]; then
    log "Waiting for DNS A record $FQDN to resolve to $INSTANCE_PUBLIC_IP..."
    DNS_MATCHED=0
    for i in {1..30}; do
        RESOLVED_IPS="$(getent ahostsv4 "$FQDN" | awk '{print $1}' | sort -u | tr '\\n' ' ' || true)"
        if echo " $RESOLVED_IPS " | grep -q " $INSTANCE_PUBLIC_IP "; then
            DNS_MATCHED=1
            log "DNS is ready for $FQDN (matched: $INSTANCE_PUBLIC_IP)"
            break
        fi
        log "DNS not ready yet for $FQDN (attempt $i/30). Current IPs: \${RESOLVED_IPS:-none}"
        sleep 10
    done
    if [ "$DNS_MATCHED" -ne 1 ]; then
        log "WARNING: DNS did not resolve to this server in time, keeping bootstrap certificate for now."
    fi
else
    log "WARNING: Could not determine instance public IPv4, skipping strict DNS readiness check."
fi

log "Requesting Let's Encrypt certificate via Certbot webroot..."
if certbot certonly --webroot -w ${stackDir}/certbot-webroot -d "$FQDN" --non-interactive --agree-tos ${emailArgs}; then
    log "Let's Encrypt certificate obtained successfully for $FQDN"

    log "Switching NGINX config to Let's Encrypt certificates..."
    cat > ${stackDir}/sites-enabled/default.conf <<'EOF'
${letsEncryptNginxConfig}
EOF

    docker exec ${nginxContainerName} nginx -s reload || {
        log "WARNING: Failed to reload NGINX container after certificate issuance"
    }
else
    log "WARNING: Certbot failed to obtain certificate. Continuing with bootstrap certificate."
fi

log "Configuring automatic Certbot renewal..."
if ! grep -q "certbot renew -q --deploy-hook 'docker exec ${nginxContainerName} nginx -s reload'" /etc/crontab; then
    echo "0 0,12 * * * root /opt/certbot/bin/python -c 'import random; import time; time.sleep(random.random() * 3600)' && certbot renew -q --deploy-hook 'docker exec ${nginxContainerName} nginx -s reload'" >> /etc/crontab
fi
`;
}
