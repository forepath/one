/** One entry of the top bar's "Create" menu (3.37). */
export interface CreateKind {
  /** The resource kind; `null` = "Other kind" (YAML only). */
  kind: string | null;
  icon: string;
  label: string;
}

/**
 * Typed creation, most used first; "Other kind" opens the modal at its Kind step. Only published kinds (2026-10-29:
 * "Volume" is no resource kind — volumes are part of a Deployment's compose file — so it left the menu).
 */
export const CREATE_KINDS: CreateKind[] = [
  { kind: 'Deployment', icon: 'bi-box-seam', label: $localize`:@@lwConsoleCreate-deployment:Deployment` },
  {
    kind: 'VirtualMachine',
    icon: 'bi-pc-display',
    label: $localize`:@@lwConsoleCreate-virtualMachine:Virtual machine`,
  },
  { kind: 'Policy', icon: 'bi-shield-shaded', label: $localize`:@@lwConsoleCreate-policy:Policy` },
  { kind: 'DnsRecord', icon: 'bi-globe2', label: $localize`:@@lwConsoleCreate-dnsRecord:DNS record` },
  { kind: null, icon: 'bi-file-earmark-code', label: $localize`:@@lwConsoleCreate-other:Other kind…` },
];

/**
 * Empty-state hint of single-kind resource tables (2026-10-29): no create button in the empty state; the table-head
 * "+" (or the top-bar "+") creates, both opening the resource modal.
 */
export const CREATE_HINT = $localize`:@@lwConsoleCreate-hint:Create one with +.`;
