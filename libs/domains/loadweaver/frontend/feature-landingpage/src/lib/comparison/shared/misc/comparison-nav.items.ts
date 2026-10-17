import type { ComparisonSlug } from '../matrix/comparison-matrix.model';

export interface ComparisonNavItem {
  readonly slug: ComparisonSlug;
  readonly label: string;
  readonly routerLink: string;
}

export const PORTAL_COMPARISON_NAV_ITEMS: readonly ComparisonNavItem[] = [
  {
    slug: 'kubernetes',
    label: $localize`:@@featureLoadweaverComparison-navKubernetes:Kubernetes / k3s`,
    routerLink: '/compare/kubernetes',
  },
  {
    slug: 'docker-swarm',
    label: $localize`:@@featureLoadweaverComparison-navDockerSwarm:Docker Swarm`,
    routerLink: '/compare/docker-swarm',
  },
  { slug: 'nomad', label: $localize`:@@featureLoadweaverComparison-navNomad:Nomad`, routerLink: '/compare/nomad' },
  {
    slug: 'coolify-dokploy',
    label: $localize`:@@featureLoadweaverComparison-navCoolifyDokploy:Coolify / Dokploy`,
    routerLink: '/compare/coolify-dokploy',
  },
  {
    slug: 'portainer',
    label: $localize`:@@featureLoadweaverComparison-navPortainer:Portainer`,
    routerLink: '/compare/portainer',
  },
];
