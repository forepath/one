import type {
  ComparisonMatrixRowLabel,
  ComparisonMatrixRowViewModel,
  ComparisonSlug,
  MatrixStrength,
} from './comparison-matrix.model';

/**
 * Same 13 dimensions and customer questions on every comparison page.
 * Scoring rubric aligns with independent research (May 2026) in `.context/Marketing - Competitive Matrix Result.md`.
 */
export const COMPARISON_MATRIX_ROW_LABELS: readonly ComparisonMatrixRowLabel[] = [
  {
    dimension: $localize`:@@featurePortalComparison-matrixDim1:Multi-workspace control plane`,
    question: $localize`:@@featurePortalComparison-matrixQ1:Can we manage many isolated agent backends from one console?`,
  },
  {
    dimension: $localize`:@@featurePortalComparison-matrixDim2:Team RBAC per workspace`,
    question: $localize`:@@featurePortalComparison-matrixQ2:Can we invite teammates with roles per workspace or client?`,
  },
  {
    dimension: $localize`:@@featurePortalComparison-matrixDim3:Self-hosted / VPC deployment`,
    question: $localize`:@@featurePortalComparison-matrixQ3:Can we run on our own infrastructure or private cloud?`,
  },
  {
    dimension: $localize`:@@featurePortalComparison-matrixDim4:Real-time chat + execution environment`,
    question: $localize`:@@featurePortalComparison-matrixQ4:Does the assistant run in a controlled runtime with chat and logs?`,
  },
  {
    dimension: $localize`:@@featurePortalComparison-matrixDim5:In-browser IDE + Git`,
    question: $localize`:@@featurePortalComparison-matrixQ5:Can we edit, commit, branch, and push inside the product?`,
  },
  {
    dimension: $localize`:@@featurePortalComparison-matrixDim6:Ticket-centric workflow`,
    question: $localize`:@@featurePortalComparison-matrixQ6:Does the product center structured work items in addition to free-form chat?`,
  },
  {
    dimension: $localize`:@@featurePortalComparison-matrixDim7:Organizational knowledge for agents`,
    question: $localize`:@@featurePortalComparison-matrixQ7:Can we curate reusable knowledge that agents draw on?`,
  },
  {
    dimension: $localize`:@@featurePortalComparison-matrixDim8:CI/CD from the product`,
    question: $localize`:@@featurePortalComparison-matrixQ8:Can we trigger pipelines or track deployment runs alongside agents?`,
  },
  {
    dimension: $localize`:@@featurePortalComparison-matrixDim9:Automated cloud provisioning`,
    question: $localize`:@@featurePortalComparison-matrixQ9:Can we automatically provision hosts for agent runtimes?`,
  },
  {
    dimension: $localize`:@@featurePortalComparison-matrixDim10:Policy, filters, audit, telemetry`,
    question: $localize`:@@featurePortalComparison-matrixQ10:Can we enforce message policy and inspect drops, flags, or audits?`,
  },
  {
    dimension: $localize`:@@featurePortalComparison-matrixDim11:Usage & lifecycle observability`,
    question: $localize`:@@featurePortalComparison-matrixQ11:Can operators see usage, sessions, or lifecycle signals?`,
  },
  {
    dimension: $localize`:@@featurePortalComparison-matrixDim12:Extensible providers / plugins`,
    question: $localize`:@@featurePortalComparison-matrixQ12:Can we plug in agent providers or chat filters without forking core?`,
  },
  {
    dimension: $localize`:@@featurePortalComparison-matrixDim13:Enterprise SSO / IdP`,
    question: $localize`:@@featurePortalComparison-matrixQ13:Does it fit SAML/OIDC SSO and enterprise identity patterns?`,
  },
];

const AGENSTRA_SCORES: readonly MatrixStrength[] = [
  'strong',
  'strong',
  'strong',
  'strong',
  'strong',
  'strong',
  'strong',
  'strong',
  'strong',
  'strong',
  'strong',
  'strong',
  'strong',
];
const AGENSTRA_TOOLTIPS: readonly string[] = [
  $localize`:@@featurePortalComparison-agenstraT1:Controller + RBAC over many remote agent-manager endpoints from one console.`,
  $localize`:@@featurePortalComparison-agenstraT2:Per-client users with admin/user roles; Keycloak or JWT users. API-key mode bypasses user checks.`,
  $localize`:@@featurePortalComparison-agenstraT3:Dockerized controller and manager; you choose where they run. EU-friendly provider automation where offered.`,
  $localize`:@@featurePortalComparison-agenstraT4:WebSocket chat to Docker-backed agents with logs and container lifecycle via agent-manager.`,
  $localize`:@@featurePortalComparison-agenstraT5:Monaco editor plus proxied Git (status, branches, commit, push, pull, rebase, conflicts).`,
  $localize`:@@featurePortalComparison-agenstraT6:Ticket REST, realtime board, automation and migration APIs on the controller.`,
  $localize`:@@featurePortalComparison-agenstraT7:Knowledge tree, relations, activity, and prompt-context endpoints.`,
  $localize`:@@featurePortalComparison-agenstraT8:Deployments APIs cover configs, workflows, runs, logs, and cancel. All of that is scoped to agents.`,
  $localize`:@@featurePortalComparison-agenstraT9:Documented automation for Hetzner and DigitalOcean to install agent-manager and register clients.`,
  $localize`:@@featurePortalComparison-agenstraT10:Global regex filter rules, pluggable chat filters, statistics for drops/flags and entity events.`,
  $localize`:@@featurePortalComparison-agenstraT11:Statistics REST for chat I/O, filter incidents, and entity lifecycle (per client and aggregate).`,
  $localize`:@@featurePortalComparison-agenstraT12:Plugin agent providers and chat filters in agent-manager.`,
  $localize`:@@featurePortalComparison-agenstraT13:Keycloak OIDC/SAML, built-in JWT users, or static API key. Federate corporate IdPs via Keycloak where needed.`,
];
const COMPETITOR_SCORES: Record<ComparisonSlug, readonly MatrixStrength[]> = {
  devin: [
    'partial',
    'strong',
    'weak',
    'strong',
    'strong',
    'strong',
    'partial',
    'strong',
    'weak',
    'partial',
    'strong',
    'partial',
    'strong',
  ],
  cursor: [
    'weak',
    'partial',
    'weak',
    'strong',
    'weak',
    'weak',
    'partial',
    'partial',
    'na',
    'partial',
    'partial',
    'weak',
    'partial',
  ],
  'github-copilot': [
    'partial',
    'strong',
    'partial',
    'partial',
    'weak',
    'partial',
    'partial',
    'strong',
    'partial',
    'strong',
    'strong',
    'weak',
    'strong',
  ],
  'codeium-windsurf': [
    'weak',
    'strong',
    'strong',
    'partial',
    'weak',
    'weak',
    'partial',
    'partial',
    'na',
    'partial',
    'partial',
    'partial',
    'strong',
  ],
  'tabnine-enterprise': [
    'weak',
    'strong',
    'strong',
    'weak',
    'weak',
    'weak',
    'weak',
    'weak',
    'na',
    'partial',
    'partial',
    'weak',
    'strong',
  ],
  portkey: [
    'strong',
    'strong',
    'strong',
    'partial',
    'weak',
    'weak',
    'strong',
    'strong',
    'weak',
    'strong',
    'strong',
    'strong',
    'strong',
  ],
  'orq-ai': [
    'strong',
    'strong',
    'strong',
    'partial',
    'weak',
    'partial',
    'strong',
    'strong',
    'weak',
    'strong',
    'strong',
    'strong',
    'strong',
  ],
};
const COMPETITOR_TOOLTIPS: Record<ComparisonSlug, readonly string[]> = {
  devin: [
    $localize`:@@featurePortalComparison-devinT1:Multi-org enterprise APIs exist; focus is vendor-hosted sessions, not your fleet of independent runtimes.`,
    $localize`:@@featurePortalComparison-devinT2:Enterprise RBAC and org APIs for members and audit.`,
    $localize`:@@featurePortalComparison-devinT3:Public docs emphasize Cognition-hosted sandboxes; self-hosted/VPC not documented broadly.`,
    $localize`:@@featurePortalComparison-devinT4:Browser workspace with shell, editor, and tests in a managed sandbox.`,
    $localize`:@@featurePortalComparison-devinT5:Integrated editor, terminal, and Git flows inside Devin’s workspace.`,
    $localize`:@@featurePortalComparison-devinT6:Strong Jira-centric triggers, comments, and status loops.`,
    $localize`:@@featurePortalComparison-devinT7:Relies on repos, tickets, and workspace context rather than a dedicated knowledge tree product.`,
    $localize`:@@featurePortalComparison-devinT8:API and GitHub Actions patterns for CI gating and delivery.`,
    $localize`:@@featurePortalComparison-devinT9:Vendor provisions sandboxes; customers do not drive first-class “bring your own cloud host” automation.`,
    $localize`:@@featurePortalComparison-devinT10:Enterprise consumption and audit APIs; fine-grained public policy docs may be thinner than gateway-first tools.`,
    $localize`:@@featurePortalComparison-devinT11:Enterprise endpoints for consumption metrics and audit-oriented logs.`,
    $localize`:@@featurePortalComparison-devinT12:Integrations and APIs exist; not positioned as an arbitrary multi-provider agent-plugin host.`,
    $localize`:@@featurePortalComparison-devinT13:Enterprise SSO and RBAC are typical for this category; confirm in your contract.`,
  ],
  cursor: [
    $localize`:@@featurePortalComparison-cursorT1:Projects sit under one account. A multi-runtime agent control plane is not the model.`,
    $localize`:@@featurePortalComparison-cursorT2:Team billing and sharing; deep per-workspace RBAC is not the headline.`,
    $localize`:@@featurePortalComparison-cursorT3:Cloud-dependent assistant; local privacy modes differ from self-hosting the control plane.`,
    $localize`:@@featurePortalComparison-cursorT4:Agent and cloud-agent modes with commands in your environment or vendor infra.`,
    $localize`:@@featurePortalComparison-cursorT5:Primary surface is the desktop editor, not a dedicated browser IDE.`,
    $localize`:@@featurePortalComparison-cursorT6:No first-class ticket board; relies on external trackers.`,
    $localize`:@@featurePortalComparison-cursorT7:@-mentions and repo context apply. A curated org knowledge module is not included.`,
    $localize`:@@featurePortalComparison-cursorT8:Improves code that your existing CI builds; no native pipeline orchestration UI.`,
    $localize`:@@featurePortalComparison-cursorT9:Not an infrastructure provisioning product.`,
    $localize`:@@featurePortalComparison-cursorT10:Privacy modes and controls; not a central regex/guardrail gateway.`,
    $localize`:@@featurePortalComparison-cursorT11:Editor telemetry rather than a dedicated agent observability plane.`,
    $localize`:@@featurePortalComparison-cursorT12:Multiple models internally; not a pluggable provider framework you host.`,
    $localize`:@@featurePortalComparison-cursorT13:SSO on business tiers still means vendor SaaS. Your IdP is not fronting a self-hosted plane.`,
  ],
  'github-copilot': [
    $localize`:@@featurePortalComparison-copilotT1:GitHub orgs, repos, and Copilot settings apply. A separate agent control-plane product is not the positioning.`,
    $localize`:@@featurePortalComparison-copilotT2:GitHub Enterprise RBAC, SSO, and SCIM carry permissions.`,
    $localize`:@@featurePortalComparison-copilotT3:Microsoft/GitHub-hosted service; coding agent can use self-hosted runners for jobs.`,
    $localize`:@@featurePortalComparison-copilotT4:Copilot chat in IDE; coding agent runs in Actions-style environments.`,
    $localize`:@@featurePortalComparison-copilotT5:GitHub web UI and Codespaces exist, but Copilot is IDE/GitHub-centric.`,
    $localize`:@@featurePortalComparison-copilotT6:Issues and PRs anchor the workflow. A standalone agent ticket board is not included.`,
    $localize`:@@featurePortalComparison-copilotT7:Repositories and wikis hold knowledge; no separate knowledge tree feature.`,
    $localize`:@@featurePortalComparison-copilotT8:Tight GitHub Actions integration including coding agent on runners.`,
    $localize`:@@featurePortalComparison-copilotT9:General runner autoscaling exists. It is not the same as Agenstra-style agent-host provisioning.`,
    $localize`:@@featurePortalComparison-copilotT10:Enterprise audit logs, policies, and compliance packaging around GitHub.`,
    $localize`:@@featurePortalComparison-copilotT11:GitHub Enterprise and Actions telemetry; deep agent lifecycle dashboards are GitHub-shaped.`,
    $localize`:@@featurePortalComparison-copilotT12:Model routing is vendor-controlled. Customer plugin providers are not the model.`,
    $localize`:@@featurePortalComparison-copilotT13:Copilot Enterprise SSO/SCIM via GitHub Enterprise IdP integrations.`,
  ],
  'codeium-windsurf': [
    $localize`:@@featurePortalComparison-codeiumT1:Org/workspace for configuration; not a multi-runtime agent operations console.`,
    $localize`:@@featurePortalComparison-codeiumT2:Enterprise roles, SSO, and self-hosted backends supported.`,
    $localize`:@@featurePortalComparison-codeiumT3:Hybrid and on-prem enterprise deployments with compliance posture.`,
    $localize`:@@featurePortalComparison-codeiumT4:IDE chat and agentic edits; not a generic remote container per workspace.`,
    $localize`:@@featurePortalComparison-codeiumT5:Windsurf is desktop-first; not a browser IDE product.`,
    $localize`:@@featurePortalComparison-codeiumT6:No native ticket system; uses your existing trackers.`,
    $localize`:@@featurePortalComparison-codeiumT7:RAG and context features apply. A structured org knowledge tree is a different product shape.`,
    $localize`:@@featurePortalComparison-codeiumT8:Changes land in Git; CI is external to the assistant.`,
    $localize`:@@featurePortalComparison-codeiumT9:No agent-host provisioning module.`,
    $localize`:@@featurePortalComparison-codeiumT10:Zero-retention and compliance emphasis; fewer policy-as-code gateways than LLM routers.`,
    $localize`:@@featurePortalComparison-codeiumT11:Usage dashboards; lighter agent lifecycle observability.`,
    $localize`:@@featurePortalComparison-codeiumT12:Multiple backends possible; plugin ecosystem differs from agent-manager style providers.`,
    $localize`:@@featurePortalComparison-codeiumT13:Enterprise SSO with major IdPs on self-hosted/hybrid plans.`,
  ],
  'tabnine-enterprise': [
    $localize`:@@featurePortalComparison-tabnineT1:Central admin covers the Tabnine cluster. Many independent agent runtimes are out of scope.`,
    $localize`:@@featurePortalComparison-tabnineT2:SSO groups and team management for enterprise installs.`,
    $localize`:@@featurePortalComparison-tabnineT3:VPC and air-gapped private installs are a core pitch.`,
    $localize`:@@featurePortalComparison-tabnineT4:Completions and chat inside the IDE; no separate remote agent sandbox product.`,
    $localize`:@@featurePortalComparison-tabnineT5:IDE integration only.`,
    $localize`:@@featurePortalComparison-tabnineT6:No ticketing product.`,
    $localize`:@@featurePortalComparison-tabnineT7:Local code context applies. A curated knowledge base layer is not the focus.`,
    $localize`:@@featurePortalComparison-tabnineT8:No deployment orchestration from Tabnine itself.`,
    $localize`:@@featurePortalComparison-tabnineT9:You operate infrastructure; no cloud agent-host wizard.`,
    $localize`:@@featurePortalComparison-tabnineT10:On-prem posture; detailed message-filter telemetry APIs are not the focus.`,
    $localize`:@@featurePortalComparison-tabnineT11:Console usage views; narrower than gateway tracing.`,
    $localize`:@@featurePortalComparison-tabnineT12:Assistant-focused; limited extensibility compared to plugin agent hosts.`,
    $localize`:@@featurePortalComparison-tabnineT13:Documented SAML/OIDC SSO for enterprise clusters.`,
  ],
  portkey: [
    $localize`:@@featurePortalComparison-portkeyT1:Org and workspace hierarchy routes all model traffic. The product is a gateway control plane.`,
    $localize`:@@featurePortalComparison-portkeyT2:Granular org and workspace roles for configs, keys, and logs.`,
    $localize`:@@featurePortalComparison-portkeyT3:VPC / private deployment as an enterprise LLM gateway.`,
    $localize`:@@featurePortalComparison-portkeyT4:Controls LLM/tool calls; execution stays in your apps or agents.`,
    $localize`:@@featurePortalComparison-portkeyT5:This is an operations console. It is not an interactive coding IDE.`,
    $localize`:@@featurePortalComparison-portkeyT6:Not a ticket system; integrates via surrounding tools.`,
    $localize`:@@featurePortalComparison-portkeyT7:Central prompts, configs, and guardrail artifacts reused org-wide.`,
    $localize`:@@featurePortalComparison-portkeyT8:CI/CD hooks documented for instrumenting pipelines at the gateway.`,
    $localize`:@@featurePortalComparison-portkeyT9:You provision infra; gateway doesn’t specialize in VM agent-host setup.`,
    $localize`:@@featurePortalComparison-portkeyT10:Guardrails, traces, and decision logs are core to the product.`,
    $localize`:@@featurePortalComparison-portkeyT11:Deep LLM and agent call observability covers latency, cost, and errors.`,
    $localize`:@@featurePortalComparison-portkeyT12:Many providers and MCP-style connectivity via configuration.`,
    $localize`:@@featurePortalComparison-portkeyT13:Enterprise SSO/IAM integrations for the gateway.`,
  ],
  'orq-ai': [
    $localize`:@@featurePortalComparison-orqT1:Workspaces and projects for many agents and deployments.`,
    $localize`:@@featurePortalComparison-orqT2:Teams with Admin/Developer/Researcher-style roles.`,
    $localize`:@@featurePortalComparison-orqT3:Private cloud listings and compliance posture (e.g., SOC2, GDPR).`,
    $localize`:@@featurePortalComparison-orqT4:Orchestrates agents/tools; execution relies on connected infrastructure.`,
    $localize`:@@featurePortalComparison-orqT5:This is a lifecycle console. It is not a full browser IDE for repo work.`,
    $localize`:@@featurePortalComparison-orqT6:Experiments/deployments focus; not a first-class ticket board.`,
    $localize`:@@featurePortalComparison-orqT7:Projects aggregate prompts, models, and deployment knowledge.`,
    $localize`:@@featurePortalComparison-orqT8:Deployment workflows and monitoring are first-class.`,
    $localize`:@@featurePortalComparison-orqT9:No documented VM provisioning comparable to Agenstra’s host bootstrap.`,
    $localize`:@@featurePortalComparison-orqT10:Monitoring, evaluation, and compliance emphasis.`,
    $localize`:@@featurePortalComparison-orqT11:Agent monitoring across projects and deployments.`,
    $localize`:@@featurePortalComparison-orqT12:Multiple models and custom tools/workflows.`,
    $localize`:@@featurePortalComparison-orqT13:Enterprise authentication patterns documented for workspaces.`,
  ],
};

export function buildComparisonMatrixRows(slug: ComparisonSlug): ComparisonMatrixRowViewModel[] {
  const competitorScores = COMPETITOR_SCORES[slug];
  const competitorTooltips = COMPETITOR_TOOLTIPS[slug];

  return COMPARISON_MATRIX_ROW_LABELS.map((label, index) => {
    const agenstra = AGENSTRA_SCORES[index];
    const agenstraTooltip = AGENSTRA_TOOLTIPS[index];
    const competitor = competitorScores[index];
    const competitorTooltip = competitorTooltips[index];

    if (
      agenstra === undefined ||
      agenstraTooltip === undefined ||
      competitor === undefined ||
      competitorTooltip === undefined
    ) {
      throw new Error(`Missing comparison matrix data for ${slug} row ${String(index)}`);
    }

    return {
      ...label,
      agenstra,
      agenstraTooltip,
      competitor,
      competitorTooltip,
    };
  });
}
