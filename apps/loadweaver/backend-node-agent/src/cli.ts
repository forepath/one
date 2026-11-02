export const USAGE = `Usage: loadweaver-agent <command> [options]

Commands:
  bootstrap --name <node> --public-host <host> [--cluster-name <name>] [--public-url <https-url>]
            [--admin-claim-token-file <file>]
            Create a new cluster on this node (control plane, database, API) and join it.
            --public-url: the API's public HTTPS URL (LOADWEAVER_PUBLIC_URL: installer line, registry, OAuth
            callbacks), e.g. when a TLS proxy in front of the node serves console and API on one origin.
            --admin-claim-token-file: one-time admin claim token (or LOADWEAVER_ADMIN_CLAIM_TOKEN); while the
            cluster has no account, the first console registration (the administrator) must present it. Only
            its SHA-256 is kept.
            Email (optional; 2FA codes, confirmations, notifications): [--smtp-host <host>] [--smtp-port <587>]
            [--smtp-user <user> --smtp-password-file <file>] [--email-from <address>]
            [--email-company-name|-address|-postal-code|-city|-country|-vat-id|-email <value>]
            The SMTP password from --smtp-password-file or LOADWEAVER_SMTP_PASSWORD (never on the command line);
            port 465 is SMTPS. Without SMTP, forced email two-factor login is not enforced.
  bootstrap --restore --name <node> --public-host <host> <target> <key> [--target-time <iso>]
            [--no-volume-restore] [--keep-staging]
            Whole-cluster disaster recovery on a fresh node: restores the control plane (etcd, database,
            environment, master key) from the external copy of the platform backups, starts it on this node,
            marks the previous nodes lost and restores the volumes from their backups.
            <target>: --dr-info <file> [--target <name>]   (DR info file from the console, Backups > Platform)
                   or --s3-endpoint <url> --s3-bucket <bucket> [--s3-region <r>] [--s3-prefix <p/>]
                   or --sftp-host <h> [--sftp-port 22] --sftp-user <u> --sftp-path </p> --known-hosts-file <f>
                   S3 keys from LOADWEAVER_DR_ACCESS_KEY_ID / LOADWEAVER_DR_SECRET_ACCESS_KEY (read access is
                   enough); SFTP with --sftp-key-file <f>.
            <key>:    --share-file <f> (repeat for each recovery-kit share, k of n), or nothing to type / paste the
                   shares, or --kms vault-transit with VAULT_ADDR / VAULT_TOKEN (KMS escrow of the backup key).
  join      --server <https-url> --name <node> [--token <token>] [--endpoint-host <host>]
            [--label key=value ...] [--ca-cert-hash sha256:<hex>]
            [--discover]
            Join an existing cluster. Prefer LOADWEAVER_JOIN_TOKEN over --token (process list).
            --discover: import an existing Docker host or former node (read-only discovery sent with the join;
            the node stays pending and unchanged until its join plan is approved in the import wizard).
  discover  [--output <file>]
            Read-only discovery of this host (compose projects, containers, volumes, ports, interfaces, routes,
            VPNs, nftables, former Loadweaver markers) as JSON; changes nothing.
  run       Run the agent (systemd service).
  version   Print the agent version.
`;

export {
  BOOTSTRAP_EMAIL_FLAGS,
  BOOTSTRAP_OPTIONS,
  NEW_CLUSTER_ONLY_FLAGS,
  parseLabels,
  readAdminClaimToken,
  readBootstrapEmailSettings,
  RESTORE_ONLY_FLAGS,
  shareThreshold,
  splitPastedShares,
} from '@forepath/loadweaver/backend/feature-node-agent';
