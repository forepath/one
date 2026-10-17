export const USAGE = `Usage: loadweaver-agent <command> [options]

Commands:
  bootstrap --name <node> --public-host <host> [--cluster-name <name>]
            Create a new cluster on this node (control plane, database, API) and join it.
  join      --server <https-url> --name <node> [--token <token>] [--endpoint-host <host>]
            [--label key=value ...] [--ca-cert-hash sha256:<hex>]
            Join an existing cluster. Prefer LOADWEAVER_JOIN_TOKEN over --token (process list).
  run       Run the agent (systemd service).
  version   Print the agent version.
`;

const LABEL =
  /^([a-z0-9]([a-z0-9.-]*[a-z0-9])?\/)?[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?=([A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?)?$/;

/** `key=value` pairs from repeated `--label` flags. */
export function parseLabels(values: string[]): Record<string, string> {
  const labels: Record<string, string> = {};

  for (const value of values) {
    if (!LABEL.test(value)) throw new Error(`invalid label ${value}`);

    const index = value.indexOf('=');

    labels[value.slice(0, index)] = value.slice(index + 1);
  }

  return labels;
}
