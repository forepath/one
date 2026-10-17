import type { ComparisonSlug } from '../matrix/comparison-matrix.model';

import type { ComparisonPageConfig } from './comparison-page.model';

/** Shared Loadweaver lead: high availability for a handful of servers with Docker Compose. */
const OVERVIEW_LOADWEAVER_LEAD = $localize`:@@featureLoadweaverComparison-overviewLoadweaver:Loadweaver starts with a handful of servers, often spread across sites, grows to around 1,000 nodes per cluster, and keeps the Docker Compose files you already have. Encrypted networking, replicated storage, ingress failover and policies are built in, and every change is a reviewed plan, so teams get high availability without running Kubernetes.`;

export const COMPARISON_PAGES: Record<ComparisonSlug, ComparisonPageConfig> = {
  kubernetes: {
    slug: 'kubernetes',
    competitorDisplayName: 'Kubernetes / k3s',
    metaTitle: $localize`:@@featureLoadweaverComparison-kubernetes-metaTitle:Kubernetes / k3s vs Loadweaver :: Loadweaver`,
    metaDescription: $localize`:@@featureLoadweaverComparison-kubernetes-metaDescription:Compare Kubernetes and k3s with Loadweaver: high availability for a handful of servers with Docker Compose, encrypted multi-site networking, replicated storage and plan and apply, without Kubernetes complexity.`,
    heroSubtitle: $localize`:@@featureLoadweaverComparison-kubernetes-heroSubtitle:The standard container orchestrator versus high availability for a handful of servers with Docker Compose.`,
    overviewCompetitorLead: $localize`:@@featureLoadweaverComparison-kubernetes-overviewCompetitor:Kubernetes is the industry standard for container orchestration, with a large ecosystem of add-ons for networking, storage and observability. k3s packages it as a lightweight distribution for small clusters and the edge. It fits when you want the Kubernetes API and ecosystem and have the know-how to operate it.`,
    overviewLoadweaverLead: OVERVIEW_LOADWEAVER_LEAD,
  },
  'docker-swarm': {
    slug: 'docker-swarm',
    competitorDisplayName: 'Docker Swarm',
    metaTitle: $localize`:@@featureLoadweaverComparison-swarm-metaTitle:Docker Swarm vs Loadweaver :: Loadweaver`,
    metaDescription: $localize`:@@featureLoadweaverComparison-swarm-metaDescription:Compare Docker Swarm with Loadweaver: both start from Docker and Compose; Loadweaver adds encrypted multi-site networking, replicated storage, ingress failover, policies and plan and apply.`,
    heroSubtitle: $localize`:@@featureLoadweaverComparison-swarm-heroSubtitle:The orchestrator built into Docker versus a resilient cluster that keeps your Compose files.`,
    overviewCompetitorLead: $localize`:@@featureLoadweaverComparison-swarm-overviewCompetitor:Docker Swarm is the orchestrator built into Docker Engine. It runs Compose-style stacks across a few nodes with little setup, which makes it a familiar step up from a single Docker host.`,
    overviewLoadweaverLead: OVERVIEW_LOADWEAVER_LEAD,
  },
  nomad: {
    slug: 'nomad',
    competitorDisplayName: 'Nomad',
    metaTitle: $localize`:@@featureLoadweaverComparison-nomad-metaTitle:Nomad vs Loadweaver :: Loadweaver`,
    metaDescription: $localize`:@@featureLoadweaverComparison-nomad-metaDescription:Compare HashiCorp Nomad with Loadweaver: a general workload scheduler versus high availability for a handful of servers with Docker Compose, built-in encrypted networking, replicated storage and policies.`,
    heroSubtitle: $localize`:@@featureLoadweaverComparison-nomad-heroSubtitle:A general workload scheduler versus a resilient cluster with networking, storage and policies built in.`,
    overviewCompetitorLead: $localize`:@@featureLoadweaverComparison-nomad-overviewCompetitor:Nomad is HashiCorp's workload orchestrator for containers and other kinds of workloads, with multi-region federation built in. It is often combined with Consul for service networking and Vault for secrets.`,
    overviewLoadweaverLead: OVERVIEW_LOADWEAVER_LEAD,
  },
  'coolify-dokploy': {
    slug: 'coolify-dokploy',
    competitorDisplayName: 'Coolify / Dokploy',
    metaTitle: $localize`:@@featureLoadweaverComparison-coolify-metaTitle:Coolify / Dokploy vs Loadweaver :: Loadweaver`,
    metaDescription: $localize`:@@featureLoadweaverComparison-coolify-metaDescription:Compare Coolify and Dokploy with Loadweaver: easy app deployment to your own servers versus a resilient multi-site cluster where no single server failure takes an app down.`,
    heroSubtitle: $localize`:@@featureLoadweaverComparison-coolify-heroSubtitle:Easy deployments to your own servers versus a cluster that survives losing one of them.`,
    overviewCompetitorLead: $localize`:@@featureLoadweaverComparison-coolify-overviewCompetitor:Coolify and Dokploy are self-hosted platforms that make deploying apps and Docker Compose projects to your own servers easy, with a web UI, Git integration and automatic certificates.`,
    overviewLoadweaverLead: OVERVIEW_LOADWEAVER_LEAD,
  },
  portainer: {
    slug: 'portainer',
    competitorDisplayName: 'Portainer',
    metaTitle: $localize`:@@featureLoadweaverComparison-portainer-metaTitle:Portainer vs Loadweaver :: Loadweaver`,
    metaDescription: $localize`:@@featureLoadweaverComparison-portainer-metaDescription:Compare Portainer with Loadweaver: a management UI for container environments versus a resilient cluster with networking, storage, failover and policies built in.`,
    heroSubtitle: $localize`:@@featureLoadweaverComparison-portainer-heroSubtitle:A management UI for container environments versus the cluster underneath, built for high availability.`,
    overviewCompetitorLead: $localize`:@@featureLoadweaverComparison-portainer-overviewCompetitor:Portainer is a management UI for Docker, Swarm and Kubernetes environments. It makes containers, stacks and access easy to manage, while scheduling, networking and storage come from the environment underneath.`,
    overviewLoadweaverLead: OVERVIEW_LOADWEAVER_LEAD,
  },
};
