import type {
  ComparisonMatrixRowLabel,
  ComparisonMatrixRowViewModel,
  ComparisonSlug,
  MatrixStrength,
} from './comparison-matrix.model';

/**
 * Same ten dimensions and questions on every comparison page. The Loadweaver column reflects the decided
 * product scope (Loadweaver is in early access). Competitor ratings stay conservative and only state what
 * the products publicly document (Strong / Partial / Weak / N.A., same scale as Agenstra).
 */
export const COMPARISON_MATRIX_ROW_LABELS: readonly ComparisonMatrixRowLabel[] = [
  {
    dimension: $localize`:@@featureLoadweaverComparison-matrixDim1:Docker Compose as the deployment unit`,
    question: $localize`:@@featureLoadweaverComparison-matrixQ1:Can we deploy the Compose files we already have?`,
  },
  {
    dimension: $localize`:@@featureLoadweaverComparison-matrixDim2:Encrypted multi-site network`,
    question: $localize`:@@featureLoadweaverComparison-matrixQ2:Are nodes at different sites connected over an encrypted overlay?`,
  },
  {
    dimension: $localize`:@@featureLoadweaverComparison-matrixDim3:Replicated storage`,
    question: $localize`:@@featureLoadweaverComparison-matrixQ3:Do volumes stay available when a node goes down?`,
  },
  {
    dimension: $localize`:@@featureLoadweaverComparison-matrixDim4:Ingress and IP failover`,
    question: $localize`:@@featureLoadweaverComparison-matrixQ4:Does public traffic move to a healthy node on its own, also for TCP / UDP?`,
  },
  {
    dimension: $localize`:@@featureLoadweaverComparison-matrixDim5:Policies between groups`,
    question: $localize`:@@featureLoadweaverComparison-matrixQ5:Is connectivity default-deny and expressed as policies between groups?`,
  },
  {
    dimension: $localize`:@@featureLoadweaverComparison-matrixDim6:Plan and apply with failure analysis`,
    question: $localize`:@@featureLoadweaverComparison-matrixQ6:Do we see a reviewed diff and every single point of failure before a change goes live?`,
  },
  {
    dimension: $localize`:@@featureLoadweaverComparison-matrixDim7:Workload migration`,
    question: $localize`:@@featureLoadweaverComparison-matrixQ7:Can workloads move between nodes, including stateful ones?`,
  },
  {
    dimension: $localize`:@@featureLoadweaverComparison-matrixDim8:Topology map and unified logs`,
    question: $localize`:@@featureLoadweaverComparison-matrixQ8:Can we see traffic flows and every platform log in one place?`,
  },
  {
    dimension: $localize`:@@featureLoadweaverComparison-matrixDim9:Made for a handful of servers`,
    question: $localize`:@@featureLoadweaverComparison-matrixQ9:Does it run well on one to a few servers without a dedicated platform team?`,
  },
  {
    dimension: $localize`:@@featureLoadweaverComparison-matrixDim10:Remote access for people and offices`,
    question: $localize`:@@featureLoadweaverComparison-matrixQ10:Can people and offices reach internal services over a VPN governed by the same policies?`,
  },
];

const LOADWEAVER_SCORES: readonly MatrixStrength[] = [
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

const LOADWEAVER_TOOLTIPS: readonly string[] = [
  $localize`:@@featureLoadweaverComparison-loadweaverT1:Compose projects with x-loadweaver extension fields; the file stays valid for plain docker compose.`,
  $localize`:@@featureLoadweaverComparison-loadweaverT2:WireGuard between nodes and sites, with tunnels and routes generated from policies.`,
  $localize`:@@featureLoadweaverComparison-loadweaverT3:Block-level replicated volumes, synchronous within a site and asynchronous across sites.`,
  $localize`:@@featureLoadweaverComparison-loadweaverT4:Failover IPs via VRRP, BGP or provider APIs, DNS failover where an IP cannot move, HTTP and L4.`,
  $localize`:@@featureLoadweaverComparison-loadweaverT5:Allow-only policies between node and workload groups, compiled into every network layer.`,
  $localize`:@@featureLoadweaverComparison-loadweaverT6:Every change is a plan with per-resource locks, rollback and a failure analysis per node and site.`,
  $localize`:@@featureLoadweaverComparison-loadweaverT7:Live migration where eligible, blue / green where replicas allow, a short stop otherwise.`,
  $localize`:@@featureLoadweaverComparison-loadweaverT8:Live, timeline and plan views of the map; all platform logs correlated by labels.`,
  $localize`:@@featureLoadweaverComparison-loadweaverT9:A single node is a full setup. The control plane grows to three members (optionally five) on its own, and every further node joins as a worker.`,
  $localize`:@@featureLoadweaverComparison-loadweaverT10:WireGuard clients and site-to-site offices with SSO enrollment and device posture.`,
];

const COMPETITOR_SCORES: Record<ComparisonSlug, readonly MatrixStrength[]> = {
  kubernetes: ['weak', 'partial', 'partial', 'partial', 'partial', 'partial', 'partial', 'partial', 'partial', 'weak'],
  'docker-swarm': ['strong', 'partial', 'weak', 'partial', 'weak', 'weak', 'partial', 'weak', 'strong', 'weak'],
  nomad: ['weak', 'partial', 'partial', 'partial', 'partial', 'partial', 'partial', 'partial', 'partial', 'weak'],
  'coolify-dokploy': ['strong', 'weak', 'weak', 'partial', 'weak', 'weak', 'weak', 'partial', 'strong', 'weak'],
  portainer: ['strong', 'na', 'na', 'na', 'weak', 'weak', 'na', 'partial', 'strong', 'weak'],
};

const COMPETITOR_TOOLTIPS: Record<ComparisonSlug, readonly string[]> = {
  kubernetes: [
    $localize`:@@featureLoadweaverComparison-kubernetesT1:Uses its own manifests; Compose files need a conversion step, for example with Kompose.`,
    $localize`:@@featureLoadweaverComparison-kubernetesT2:CNI plugins can encrypt pod traffic, for example with WireGuard; spanning sites needs its own design.`,
    $localize`:@@featureLoadweaverComparison-kubernetesT3:Through CSI drivers and storage add-ons that you choose and operate.`,
    $localize`:@@featureLoadweaverComparison-kubernetesT4:Ingress controllers plus a load balancer implementation for bare metal, such as MetalLB or kube-vip.`,
    $localize`:@@featureLoadweaverComparison-kubernetesT5:NetworkPolicy resources, enforced by a CNI plugin that supports them.`,
    $localize`:@@featureLoadweaverComparison-kubernetesT6:kubectl diff and GitOps tools show changes; there is no built-in failure analysis.`,
    $localize`:@@featureLoadweaverComparison-kubernetesT7:Pods are rescheduled and replaced; stateful moves depend on the storage layer.`,
    $localize`:@@featureLoadweaverComparison-kubernetesT8:Through observability and logging add-ons.`,
    $localize`:@@featureLoadweaverComparison-kubernetesT9:k3s is a lightweight distribution for small clusters; operating it still needs Kubernetes know-how.`,
    $localize`:@@featureLoadweaverComparison-kubernetesT10:Not part of Kubernetes; usually a separate VPN product.`,
  ],
  'docker-swarm': [
    $localize`:@@featureLoadweaverComparison-swarmT1:Deploys stacks from Compose files, with some Compose options not supported in Swarm mode.`,
    $localize`:@@featureLoadweaverComparison-swarmT2:Overlay networks can be encrypted; Swarm is designed for nodes on low-latency networks.`,
    $localize`:@@featureLoadweaverComparison-swarmT3:No built-in replicated storage; volumes rely on volume plugins.`,
    $localize`:@@featureLoadweaverComparison-swarmT4:The routing mesh publishes ports on every node; a floating public IP needs external tooling.`,
    $localize`:@@featureLoadweaverComparison-swarmT5:Isolation per overlay network; no policy model between groups.`,
    $localize`:@@featureLoadweaverComparison-swarmT6:Stack deploys apply directly, without a plan or diff step.`,
    $localize`:@@featureLoadweaverComparison-swarmT7:Services are rescheduled on other nodes; no live migration.`,
    $localize`:@@featureLoadweaverComparison-swarmT8:Service logs through the Docker CLI; no traffic map.`,
    $localize`:@@featureLoadweaverComparison-swarmT9:Built into Docker Engine and quick to set up on a few nodes.`,
    $localize`:@@featureLoadweaverComparison-swarmT10:Not included.`,
  ],
  nomad: [
    $localize`:@@featureLoadweaverComparison-nomadT1:Jobs are written in HCL; Compose files are not used directly.`,
    $localize`:@@featureLoadweaverComparison-nomadT2:Multi-region federation is built in; encrypted service traffic usually comes from a service mesh such as Consul.`,
    $localize`:@@featureLoadweaverComparison-nomadT3:Host volumes and CSI plugins; replication comes from the storage system.`,
    $localize`:@@featureLoadweaverComparison-nomadT4:Ingress through a load balancer or gateway job; floating IPs need external tooling.`,
    $localize`:@@featureLoadweaverComparison-nomadT5:Service-to-service rules through a service mesh such as Consul.`,
    $localize`:@@featureLoadweaverComparison-nomadT6:nomad job plan shows a diff and a placement dry run; no failure analysis across nodes or sites.`,
    $localize`:@@featureLoadweaverComparison-nomadT7:Allocations are rescheduled on other nodes; no live migration.`,
    $localize`:@@featureLoadweaverComparison-nomadT8:The UI shows jobs, allocations and their logs; traffic flows need extra tooling.`,
    $localize`:@@featureLoadweaverComparison-nomadT9:A single binary, often combined with Consul and Vault in production setups.`,
    $localize`:@@featureLoadweaverComparison-nomadT10:Not included.`,
  ],
  'coolify-dokploy': [
    $localize`:@@featureLoadweaverComparison-coolifyT1:Both deploy Docker Compose projects to your servers.`,
    $localize`:@@featureLoadweaverComparison-coolifyT2:Servers are added for deployments, not joined into an encrypted multi-site network.`,
    $localize`:@@featureLoadweaverComparison-coolifyT3:Volumes live on the server that runs the app.`,
    $localize`:@@featureLoadweaverComparison-coolifyT4:A built-in reverse proxy with automatic certificates; no IP failover between servers.`,
    $localize`:@@featureLoadweaverComparison-coolifyT5:No policy model between groups.`,
    $localize`:@@featureLoadweaverComparison-coolifyT6:Deployments apply directly, without a plan or failure analysis.`,
    $localize`:@@featureLoadweaverComparison-coolifyT7:Apps run on the server they are deployed to.`,
    $localize`:@@featureLoadweaverComparison-coolifyT8:Logs and basic monitoring per app in the dashboard.`,
    $localize`:@@featureLoadweaverComparison-coolifyT9:Made for single servers and small fleets, with a friendly web UI.`,
    $localize`:@@featureLoadweaverComparison-coolifyT10:Not included.`,
  ],
  portainer: [
    $localize`:@@featureLoadweaverComparison-portainerT1:Deploys Compose stacks to Docker and Swarm environments.`,
    $localize`:@@featureLoadweaverComparison-portainerT2:A management UI; networking comes from the environment underneath.`,
    $localize`:@@featureLoadweaverComparison-portainerT3:Storage comes from the environment underneath.`,
    $localize`:@@featureLoadweaverComparison-portainerT4:Ingress and failover come from the environment underneath.`,
    $localize`:@@featureLoadweaverComparison-portainerT5:Role-based access for users and teams; network policies come from the environment.`,
    $localize`:@@featureLoadweaverComparison-portainerT6:Changes apply directly, without a plan or failure analysis.`,
    $localize`:@@featureLoadweaverComparison-portainerT7:Scheduling comes from the environment underneath.`,
    $localize`:@@featureLoadweaverComparison-portainerT8:Container logs, stats and a console in the UI.`,
    $localize`:@@featureLoadweaverComparison-portainerT9:Quick to install on a single host or a few environments.`,
    $localize`:@@featureLoadweaverComparison-portainerT10:Not included.`,
  ],
};

export function buildComparisonMatrixRows(slug: ComparisonSlug): ComparisonMatrixRowViewModel[] {
  const competitorScores = COMPETITOR_SCORES[slug];
  const competitorTooltips = COMPETITOR_TOOLTIPS[slug];

  return COMPARISON_MATRIX_ROW_LABELS.map((label, index) => {
    const loadweaver = LOADWEAVER_SCORES[index];
    const loadweaverTooltip = LOADWEAVER_TOOLTIPS[index];
    const competitor = competitorScores[index];
    const competitorTooltip = competitorTooltips[index];

    if (
      loadweaver === undefined ||
      loadweaverTooltip === undefined ||
      competitor === undefined ||
      competitorTooltip === undefined
    ) {
      throw new Error(`Missing comparison matrix data for ${slug} row ${String(index)}`);
    }

    return { ...label, loadweaver, loadweaverTooltip, competitor, competitorTooltip };
  });
}
