import type { SharedLogoGridLogo } from '@forepath/shared/frontend/feature-landingpage';

import type { OperationsScene } from '../../illustrations/operations-illustration.component';

export type ForepathItServiceId = 'network' | 'compute' | 'workplace' | 'identity' | 'security' | 'resilience';

export interface ForepathItServiceAdvantage {
  icon: string;
  title: string;
  description: string;
}

/** A packaged offer built on the vendors shown on the page (e.g. Managed Microsoft 365). */
export interface ForepathItServiceSolution {
  id: string;
  icon: string;
  title: string;
  description: string;
  items: readonly string[];
  link?: { label: string; route: string; fragment?: string };
}

export interface ForepathItService {
  id: ForepathItServiceId;
  route: string;
  icon: string;
  title: string;
  /** One line under the title in the services menu. */
  navCaption: string;
  metaTitle: string;
  metaDescription: string;
  metaKeywords: string;
  heroAccent: string;
  heroRest: string;
  heroLead: string;
  logoSlots: readonly (readonly SharedLogoGridLogo[])[];
  valueTitle: string;
  valueLead: string;
  /** Operations board drawn next to the advantages (scene copy stays English, like the other scenes). */
  scene: OperationsScene;
  sceneLabel: string;
  advantages: readonly ForepathItServiceAdvantage[];
  solutions: readonly ForepathItServiceSolution[];
  ctaTitle: string;
  ctaLead: string;
}

const LOGOS = {
  acer: { id: 'acer', name: 'Acer', logoUrl: 'assets/images/logos/acer.svg', compact: true },
  amd: { id: 'amd', name: 'AMD', logoUrl: 'assets/images/logos/amd.svg', compact: true },
  apc: { id: 'apc', name: 'APC', logoUrl: 'assets/images/logos/apc.svg' },
  arista: { id: 'arista', name: 'Arista', logoUrl: 'assets/images/logos/arista.svg' },
  asus: { id: 'asus', name: 'Asus', logoUrl: 'assets/images/logos/asus.svg', compact: true },
  ceph: { id: 'ceph', name: 'Ceph', logoUrl: 'assets/images/logos/ceph.png' },
  cisco: { id: 'cisco', name: 'Cisco', logoUrl: 'assets/images/logos/cisco.svg' },
  cloudflare: { id: 'cloudflare', name: 'Cloudflare', logoUrl: 'assets/images/logos/cloudflare.svg' },
  dell: { id: 'dell', name: 'Dell', logoUrl: 'assets/images/logos/dell.svg', compact: true },
  fortinet: { id: 'fortinet', name: 'Fortinet', logoUrl: 'assets/images/logos/fortinet.svg' },
  fujitsu: { id: 'fujitsu', name: 'Fujitsu', logoUrl: 'assets/images/logos/fujitsu.svg' },
  gigabyte: { id: 'gigabyte', name: 'Gigabyte', logoUrl: 'assets/images/logos/gigabyte.svg' },
  hp: { id: 'hp', name: 'HP', logoUrl: 'assets/images/logos/hp.svg' },
  hpe: { id: 'hpe', name: 'Hewlett Packard Enterprise', logoUrl: 'assets/images/logos/hpe.svg' },
  huawei: { id: 'huawei', name: 'Huawei', logoUrl: 'assets/images/logos/huawei.svg' },
  influxdb: { id: 'influxdb', name: 'InfluxDB', logoUrl: 'assets/images/logos/influxdb.svg' },
  intel: { id: 'intel', name: 'Intel', logoUrl: 'assets/images/logos/intel.svg', compact: true },
  kioxia: { id: 'kioxia', name: 'Kioxia', logoUrl: 'assets/images/logos/kioxia.svg', compact: true },
  lenovo: { id: 'lenovo', name: 'Lenovo', logoUrl: 'assets/images/logos/lenovo.png' },
  mailstore: { id: 'mailstore', name: 'MailStore', logoUrl: 'assets/images/logos/mailstore.webp' },
  microsoft: { id: 'microsoft', name: 'Microsoft', logoUrl: 'assets/images/logos/microsoft.svg' },
  opnsense: { id: 'opnsense', name: 'OpnSense', logoUrl: 'assets/images/logos/opnsense.webp' },
  placetel: { id: 'placetel', name: 'Placetel', logoUrl: 'assets/images/logos/placetel.svg' },
  proxmox: { id: 'proxmox', name: 'Proxmox', logoUrl: 'assets/images/logos/proxmox.svg' },
  redhat: { id: 'redhat', name: 'Red Hat', logoUrl: 'assets/images/logos/redhat.svg' },
  samsung: { id: 'samsung', name: 'Samsung', logoUrl: 'assets/images/logos/samsung.svg' },
  supermicro: { id: 'supermicro', name: 'Supermicro', logoUrl: 'assets/images/logos/supermicro.svg' },
  ubuntu: { id: 'ubuntu', name: 'Ubuntu', logoUrl: 'assets/images/logos/ubuntu.svg' },
  windowsserver: { id: 'windowsserver', name: 'Windows Server', logoUrl: 'assets/images/logos/windowsserver.svg' },
} as const satisfies Record<string, SharedLogoGridLogo>;

/** Distributors we source hardware and licences through (services menu, IT systems and about page). */
export const FOREPATH_DISTRIBUTOR_LOGOS: readonly SharedLogoGridLogo[] = [
  { id: 'api', name: 'API Computerhandels GmbH', logoUrl: 'assets/images/logos/api.png' },
  { id: 'also', name: 'ALSO', logoUrl: 'assets/images/logos/also.svg' },
  { id: 'elovade', name: 'elovade (formerly Ebertlang)', logoUrl: 'assets/images/logos/elovade.svg' },
];

// The six managed IT domains, in the order of the cards on the IT systems page.
export const FOREPATH_IT_SERVICES: readonly ForepathItService[] = [
  {
    id: 'network',
    route: '/it-systems/network',
    icon: 'bi-hdd-network',
    title: $localize`:@@featureForepathItService-networkTitle:Network and connectivity`,
    navCaption: $localize`:@@featureForepathItService-networkNavCaption:LAN, Wi-Fi, firewalls, and telephony`,
    metaTitle: $localize`:@@featureForepathItService-networkMetaTitle:Managed network, firewall, and telephony :: ForePath`,
    metaDescription: $localize`:@@featureForepathItService-networkMetaDescription:ForePath plans and operates LAN, WAN, Wi-Fi, firewalls, and cloud telephony with planned changes, tested failover, and clear documentation.`,
    metaKeywords: $localize`:@@featureForepathItService-networkMetaKeywords:managed firewall, Fortinet, OPNsense, Wi-Fi, switching, Placetel, Teams telephony, network operations`,
    heroAccent: $localize`:@@featureForepathItService-networkHeroAccent:Networks`,
    heroRest: $localize`:@@featureForepathItService-networkHeroRest:that stay connected from office floor to remote site`,
    heroLead: $localize`:@@featureForepathItService-networkHeroLead:We plan, operate, and document LAN, WAN, Wi-Fi, firewalls, and telephony so your people and sites stay connected without surprises.`,
    logoSlots: [
      [LOGOS.cisco, LOGOS.arista],
      [LOGOS.fortinet, LOGOS.huawei],
      [LOGOS.opnsense, LOGOS.microsoft],
      [LOGOS.placetel],
    ],
    valueTitle: $localize`:@@featureForepathItService-networkValueTitle:Connectivity your business can count on`,
    valueLead: $localize`:@@featureForepathItService-networkValueLead:Every meeting, order, and backup depends on the network. We treat it as critical infrastructure, with planned changes, tested failover, and documentation your team can read.`,
    scene: {
      title: 'Network and connectivity',
      items: [
        { icon: 'bi-bricks', name: 'FortiGate HA pair', meta: 'Failover tested 12 days ago', status: 'ok' },
        { icon: 'bi-diagram-3', name: 'Core switches', meta: '2 of 2 online, 48 VLANs', status: 'ok' },
        { icon: 'bi-wifi', name: 'Wi-Fi access points', meta: '24 online, roaming tweak queued', status: 'scheduled' },
        { icon: 'bi-telephone', name: 'Placetel cloud PBX', meta: '38 extensions, call quality good', status: 'ok' },
      ],
      nextLabel: 'Next maintenance window',
      nextValue: 'Saturday, 06:00 to 08:00',
    },
    sceneLabel: $localize`:@@featureForepathItService-networkSceneLabel:ForePath operations board for a managed network: firewall pair, core switches, Wi-Fi and cloud telephony, all healthy, with the next maintenance window`,
    advantages: [
      {
        icon: 'bi-calendar-check',
        title: $localize`:@@featureForepathItService-networkAdvantage1Title:Planned, not improvised`,
        description: $localize`:@@featureForepathItService-networkAdvantage1Desc:Changes run in agreed maintenance windows with rollback steps written down beforehand.`,
      },
      {
        icon: 'bi-arrow-left-right',
        title: $localize`:@@featureForepathItService-networkAdvantage2Title:Failover that is tested`,
        description: $localize`:@@featureForepathItService-networkAdvantage2Desc:Redundant links and firewall pairs are switched over on purpose, not for the first time during an outage.`,
      },
      {
        icon: 'bi-wifi',
        title: $localize`:@@featureForepathItService-networkAdvantage3Title:Coverage where people work`,
        description: $localize`:@@featureForepathItService-networkAdvantage3Desc:Wi-Fi is planned from site surveys, then tuned from real usage data instead of guesswork.`,
      },
      {
        icon: 'bi-journal-text',
        title: $localize`:@@featureForepathItService-networkAdvantage4Title:Documented end to end`,
        description: $localize`:@@featureForepathItService-networkAdvantage4Desc:Topology, VLANs, rules, and access live in one place your team can reach.`,
      },
    ],
    solutions: [
      {
        id: 'managed-firewall',
        icon: 'bi-bricks',
        title: $localize`:@@featureForepathItService-networkSolution1Title:Managed firewall`,
        description: $localize`:@@featureForepathItService-networkSolution1Desc:FortiGate or OPNsense firewalls with site-to-site and remote access VPN, run by us from the first rule set to every firmware update.`,
        items: [
          $localize`:@@featureForepathItService-networkSolution1Item1:Rule set reviews and change requests with an audit trail`,
          $localize`:@@featureForepathItService-networkSolution1Item2:Firmware and signature updates in maintenance windows`,
          $localize`:@@featureForepathItService-networkSolution1Item3:High-availability pairs with regular failover tests`,
        ],
      },
      {
        id: 'managed-switching',
        icon: 'bi-diagram-3',
        title: $localize`:@@featureForepathItService-networkSolution2Title:Managed switching and Wi-Fi`,
        description: $localize`:@@featureForepathItService-networkSolution2Desc:Campus and data centre switching plus business Wi-Fi, designed around your floor plan and operated with central monitoring.`,
        items: [
          $localize`:@@featureForepathItService-networkSolution2Item1:VLAN design and segmentation for office, guest, and IoT`,
          $localize`:@@featureForepathItService-networkSolution2Item2:Site surveys, access point placement, and roaming tuning`,
          $localize`:@@featureForepathItService-networkSolution2Item3:Port, uplink, and PoE monitoring with alerting`,
        ],
      },
      {
        id: 'cloud-telephony',
        icon: 'bi-telephone',
        title: $localize`:@@featureForepathItService-networkSolution3Title:Cloud telephony`,
        description: $localize`:@@featureForepathItService-networkSolution3Desc:Placetel cloud PBX and Microsoft Teams telephony replace the phone system in the server room, with number porting and dial plans handled for you.`,
        items: [
          $localize`:@@featureForepathItService-networkSolution3Item1:Number porting, dial plans, and call routing`,
          $localize`:@@featureForepathItService-networkSolution3Item2:Desk phones, softphones, and Teams integration`,
          $localize`:@@featureForepathItService-networkSolution3Item3:Call quality monitoring and user changes on request`,
        ],
      },
    ],
    ctaTitle: $localize`:@@featureForepathItService-networkCtaTitle:Is your network ready for what comes next?`,
    ctaLead: $localize`:@@featureForepathItService-networkCtaLead:Tell us about your sites, links, and pain points. We will propose a network scope, from a single firewall to a fully managed estate.`,
  },
  {
    id: 'compute',
    route: '/it-systems/compute',
    icon: 'bi-server',
    title: $localize`:@@featureForepathItService-computeTitle:Compute and platforms`,
    navCaption: $localize`:@@featureForepathItService-computeNavCaption:Servers, virtualization, and storage`,
    metaTitle: $localize`:@@featureForepathItService-computeMetaTitle:Managed servers, virtualization, and storage :: ForePath`,
    metaDescription: $localize`:@@featureForepathItService-computeMetaDescription:ForePath sizes, procures, and operates servers, Proxmox VE virtualization, and Ceph storage with scheduled patching and capacity planning.`,
    metaKeywords: $localize`:@@featureForepathItService-computeMetaKeywords:managed servers, Proxmox VE, Ceph storage, Windows Server, Linux server, virtualization, server hardware`,
    heroAccent: $localize`:@@featureForepathItService-computeHeroAccent:Servers and platforms`,
    heroRest: $localize`:@@featureForepathItService-computeHeroRest:that stay patched, sized, and monitored`,
    heroLead: $localize`:@@featureForepathItService-computeHeroLead:We run physical servers, hypervisors, and storage across their full lifecycle, from sizing and procurement to patching and refresh.`,
    logoSlots: [
      [LOGOS.dell, LOGOS.hpe, LOGOS.lenovo, LOGOS.fujitsu],
      [LOGOS.proxmox, LOGOS.ceph, LOGOS.supermicro, LOGOS.gigabyte],
      [LOGOS.windowsserver, LOGOS.ubuntu, LOGOS.redhat],
      [LOGOS.intel, LOGOS.amd, LOGOS.samsung, LOGOS.kioxia],
    ],
    valueTitle: $localize`:@@featureForepathItService-computeValueTitle:Compute that fits the workload`,
    valueLead: $localize`:@@featureForepathItService-computeValueLead:Servers should be neither a bottleneck nor a budget sink. We size for real workloads, keep platforms current, and plan capacity before it runs out.`,
    scene: {
      title: 'Compute and platforms',
      items: [
        { icon: 'bi-boxes', name: 'Proxmox VE cluster', meta: '3 nodes, 64 VMs, HA active', status: 'ok' },
        { icon: 'bi-database', name: 'Ceph storage', meta: 'Health OK, 61% used', status: 'ok' },
        { icon: 'bi-windows', name: 'Windows Server', meta: '12 servers, patches due Saturday', status: 'scheduled' },
        { icon: 'bi-ubuntu', name: 'Ubuntu servers', meta: '18 servers, fully patched', status: 'ok' },
      ],
      nextLabel: 'Next patch window',
      nextValue: 'Saturday, 22:00 to 02:00',
    },
    sceneLabel: $localize`:@@featureForepathItService-computeSceneLabel:ForePath operations board for managed servers: Proxmox VE cluster, Ceph storage, Windows and Ubuntu servers, with the next patch window`,
    advantages: [
      {
        icon: 'bi-rulers',
        title: $localize`:@@featureForepathItService-computeAdvantage1Title:Rightsized from the start`,
        description: $localize`:@@featureForepathItService-computeAdvantage1Desc:Sizing is based on measured workloads, so you pay for capacity you actually use.`,
      },
      {
        icon: 'bi-shield-check',
        title: $localize`:@@featureForepathItService-computeAdvantage2Title:Patched on a schedule`,
        description: $localize`:@@featureForepathItService-computeAdvantage2Desc:Operating systems and firmware follow a documented patch cycle with a tested way back.`,
      },
      {
        icon: 'bi-unlock',
        title: $localize`:@@featureForepathItService-computeAdvantage3Title:Open platforms, no lock-in`,
        description: $localize`:@@featureForepathItService-computeAdvantage3Desc:Proxmox, Ceph, and Linux keep licence costs predictable and leave you free to move.`,
      },
      {
        icon: 'bi-graph-up-arrow',
        title: $localize`:@@featureForepathItService-computeAdvantage4Title:Capacity planned ahead`,
        description: $localize`:@@featureForepathItService-computeAdvantage4Desc:CPU, memory, and storage trends are reviewed before peaks turn into incidents.`,
      },
    ],
    solutions: [
      {
        id: 'proxmox',
        icon: 'bi-boxes',
        title: $localize`:@@featureForepathItService-computeSolution1Title:Managed virtualization with Proxmox VE`,
        description: $localize`:@@featureForepathItService-computeSolution1Desc:Proxmox VE clusters as an open alternative to proprietary hypervisors, including the migration of existing virtual machines and day-to-day operations.`,
        items: [
          $localize`:@@featureForepathItService-computeSolution1Item1:Cluster design, high availability, and live migration`,
          $localize`:@@featureForepathItService-computeSolution1Item2:Migration planning from your current hypervisor`,
          $localize`:@@featureForepathItService-computeSolution1Item3:Coordinated host patching without workload downtime`,
        ],
      },
      {
        id: 'ceph',
        icon: 'bi-database',
        title: $localize`:@@featureForepathItService-computeSolution2Title:Managed storage with Ceph`,
        description: $localize`:@@featureForepathItService-computeSolution2Desc:Hyperconverged or dedicated Ceph storage on enterprise SSDs that grows with your data instead of forcing a new array every few years.`,
        items: [
          $localize`:@@featureForepathItService-computeSolution2Item1:Capacity and performance planning per pool`,
          $localize`:@@featureForepathItService-computeSolution2Item2:Health monitoring and disk replacement handling`,
          $localize`:@@featureForepathItService-computeSolution2Item3:Scale-out by adding nodes, not by replacing arrays`,
        ],
      },
      {
        id: 'servers',
        icon: 'bi-terminal',
        title: $localize`:@@featureForepathItService-computeSolution3Title:Managed Windows and Linux servers`,
        description: $localize`:@@featureForepathItService-computeSolution3Desc:Windows Server, Ubuntu, and Red Hat Enterprise Linux systems run with a fixed baseline, patch cycle, and monitoring.`,
        items: [
          $localize`:@@featureForepathItService-computeSolution3Item1:Hardened baselines and configuration management`,
          $localize`:@@featureForepathItService-computeSolution3Item2:Monthly patching with vulnerability remediation`,
          $localize`:@@featureForepathItService-computeSolution3Item3:Service monitoring with alerts routed to on-call`,
        ],
      },
      {
        id: 'hardware',
        icon: 'bi-cpu',
        title: $localize`:@@featureForepathItService-computeSolution4Title:Server hardware from sizing to rack`,
        description: $localize`:@@featureForepathItService-computeSolution4Desc:Vendor-neutral server selection, procurement through our distribution partners, and installation in your rack or data centre.`,
        items: [
          $localize`:@@featureForepathItService-computeSolution4Item1:Vendor-neutral sizing based on your workloads`,
          $localize`:@@featureForepathItService-computeSolution4Item2:Procurement, warranty, and lifecycle tracking`,
          $localize`:@@featureForepathItService-computeSolution4Item3:Purchase or monthly rental through topi`,
        ],
        link: {
          label: $localize`:@@featureForepathItService-rentalLink:How hardware rental works`,
          route: '/it-systems',
          fragment: 'hardware-rental',
        },
      },
    ],
    ctaTitle: $localize`:@@featureForepathItService-computeCtaTitle:Planning a refresh or a migration?`,
    ctaLead: $localize`:@@featureForepathItService-computeCtaLead:Tell us about your servers, workloads, and growth plans. We will propose a platform and an operating scope that fits your budget.`,
  },
  {
    id: 'workplace',
    route: '/it-systems/workplace',
    icon: 'bi-pc-display',
    title: $localize`:@@featureForepathItService-workplaceTitle:Endpoints and workplace`,
    navCaption: $localize`:@@featureForepathItService-workplaceNavCaption:Devices, Microsoft 365, and support`,
    metaTitle: $localize`:@@featureForepathItService-workplaceMetaTitle:Managed Microsoft 365 and managed workplace :: ForePath`,
    metaDescription: $localize`:@@featureForepathItService-workplaceMetaDescription:ForePath runs Microsoft 365, business laptops, and desktops with standardized images, patching, licence reviews, and fast support.`,
    metaKeywords: $localize`:@@featureForepathItService-workplaceMetaKeywords:Managed Microsoft 365, managed workplace, device management, IT support, hardware rental, topi`,
    heroAccent: $localize`:@@featureForepathItService-workplaceHeroAccent:Workplaces`,
    heroRest: $localize`:@@featureForepathItService-workplaceHeroRest:where IT simply works`,
    heroLead: $localize`:@@featureForepathItService-workplaceHeroLead:Laptops, desktops, and collaboration tools are set up consistently and supported quickly, so your people can focus on their work.`,
    logoSlots: [
      [LOGOS.microsoft, LOGOS.dell],
      [LOGOS.hp, LOGOS.lenovo],
      [LOGOS.fujitsu, LOGOS.acer],
      [LOGOS.asus, LOGOS.samsung],
    ],
    valueTitle: $localize`:@@featureForepathItService-workplaceValueTitle:Less friction, more focus`,
    valueLead: $localize`:@@featureForepathItService-workplaceValueLead:Every minute spent waiting on IT is a minute lost. Standardized devices, managed Microsoft 365, and fast support keep your teams productive from first login to device refresh.`,
    scene: {
      title: 'Endpoints and workplace',
      items: [
        { icon: 'bi-microsoft', name: 'Microsoft 365 tenant', meta: '86 licences, 4 unused removed', status: 'ok' },
        { icon: 'bi-laptop', name: 'Business laptops', meta: '82 devices on the current baseline', status: 'ok' },
        {
          icon: 'bi-arrow-repeat',
          name: 'Feature update rollout',
          meta: 'Ring 2 of 3, 61 of 82 devices',
          status: 'scheduled',
        },
        { icon: 'bi-person-plus', name: 'New hire, Monday', meta: 'Device and accounts ready', status: 'ok' },
      ],
      nextLabel: 'Next onboarding',
      nextValue: 'Monday, 08:30',
    },
    sceneLabel: $localize`:@@featureForepathItService-workplaceSceneLabel:ForePath operations board for a managed workplace: Microsoft 365 tenant, business laptops, a feature update rollout and a new hire ready for Monday`,
    advantages: [
      {
        icon: 'bi-box-seam',
        title: $localize`:@@featureForepathItService-workplaceAdvantage1Title:Ready on day one`,
        description: $localize`:@@featureForepathItService-workplaceAdvantage1Desc:New colleagues find a configured device and working accounts on their first morning.`,
      },
      {
        icon: 'bi-ui-checks-grid',
        title: $localize`:@@featureForepathItService-workplaceAdvantage2Title:One baseline for every device`,
        description: $localize`:@@featureForepathItService-workplaceAdvantage2Desc:Approved software and settings are rolled out the same way on every machine.`,
      },
      {
        icon: 'bi-headset',
        title: $localize`:@@featureForepathItService-workplaceAdvantage3Title:Help when it is needed`,
        description: $localize`:@@featureForepathItService-workplaceAdvantage3Desc:Remote support for quick fixes, on-site visits when hands are needed.`,
      },
      {
        icon: 'bi-recycle',
        title: $localize`:@@featureForepathItService-workplaceAdvantage4Title:A clean lifecycle`,
        description: $localize`:@@featureForepathItService-workplaceAdvantage4Desc:Refresh and disposal follow a plan, including certified data wiping.`,
      },
    ],
    solutions: [
      {
        id: 'microsoft-365',
        icon: 'bi-microsoft',
        title: $localize`:@@featureForepathItService-workplaceSolution1Title:Managed Microsoft 365`,
        description: $localize`:@@featureForepathItService-workplaceSolution1Desc:Microsoft 365 administration covering licensing, Exchange Online, Teams, SharePoint, and OneDrive, with licences sourced through our distribution partners.`,
        items: [
          $localize`:@@featureForepathItService-workplaceSolution1Item1:Tenant setup, migration, and secure defaults`,
          $localize`:@@featureForepathItService-workplaceSolution1Item2:Licence reviews that remove unused seats`,
          $localize`:@@featureForepathItService-workplaceSolution1Item3:User lifecycle, shared mailboxes, and Teams governance`,
        ],
      },
      {
        id: 'managed-workplace',
        icon: 'bi-laptop',
        title: $localize`:@@featureForepathItService-workplaceSolution2Title:Managed workplace`,
        description: $localize`:@@featureForepathItService-workplaceSolution2Desc:Business laptops and desktops with standardized images, automated software deployment, and patch management across your fleet.`,
        items: [
          $localize`:@@featureForepathItService-workplaceSolution2Item1:Standardized imaging with approved software baselines`,
          $localize`:@@featureForepathItService-workplaceSolution2Item2:Operating system and application patching`,
          $localize`:@@featureForepathItService-workplaceSolution2Item3:Remote and on-site support through refresh and disposal cycles`,
        ],
      },
      {
        id: 'workplace-rental',
        icon: 'bi-wallet2',
        title: $localize`:@@featureForepathItService-workplaceSolution3Title:Workplace as a service`,
        description: $localize`:@@featureForepathItService-workplaceSolution3Desc:Rent devices together with ForePath managed services for one monthly rate through our partnership with topi.`,
        items: [
          $localize`:@@featureForepathItService-workplaceSolution3Item1:Predictable monthly rates instead of upfront purchases`,
          $localize`:@@featureForepathItService-workplaceSolution3Item2:Warranty included, optional topi Care for repairs`,
          $localize`:@@featureForepathItService-workplaceSolution3Item3:Add devices for new hires without a new capital cycle`,
        ],
        link: {
          label: $localize`:@@featureForepathItService-rentalLink:How hardware rental works`,
          route: '/it-systems',
          fragment: 'hardware-rental',
        },
      },
    ],
    ctaTitle: $localize`:@@featureForepathItService-workplaceCtaTitle:Want IT your team stops noticing?`,
    ctaLead: $localize`:@@featureForepathItService-workplaceCtaLead:Tell us how many people and devices you support today. We will propose a workplace scope, from Microsoft 365 alone to fully managed devices.`,
  },
  {
    id: 'identity',
    route: '/it-systems/identity',
    icon: 'bi-door-open',
    title: $localize`:@@featureForepathItService-identityTitle:Identity and access`,
    navCaption: $localize`:@@featureForepathItService-identityNavCaption:Accounts, permissions, and door access`,
    metaTitle: $localize`:@@featureForepathItService-identityMetaTitle:Managed identity and access :: ForePath`,
    metaDescription: $localize`:@@featureForepathItService-identityMetaDescription:ForePath manages Microsoft Entra ID, Active Directory, single sign-on, MFA, and physical access with clear roles and audit trails.`,
    metaKeywords: $localize`:@@featureForepathItService-identityMetaKeywords:Microsoft Entra ID, Active Directory, single sign-on, MFA, access control, identity management`,
    heroAccent: $localize`:@@featureForepathItService-identityHeroAccent:Access`,
    heroRest: $localize`:@@featureForepathItService-identityHeroRest:for the right people at the right time`,
    heroLead: $localize`:@@featureForepathItService-identityHeroLead:We manage digital and physical access as one discipline, with clear roles, fast onboarding, and audit trails that stand up to review.`,
    logoSlots: [[LOGOS.microsoft], [LOGOS.windowsserver], [LOGOS.fortinet], [LOGOS.redhat]],
    valueTitle: $localize`:@@featureForepathItService-identityValueTitle:Access under control`,
    valueLead: $localize`:@@featureForepathItService-identityValueLead:Every account and every badge is a door into your business. We keep track of who can open which one, and close it the day someone leaves.`,
    scene: {
      title: 'Identity and access',
      items: [
        { icon: 'bi-people', name: 'Entra ID and Active Directory', meta: 'Sync healthy, 112 accounts', status: 'ok' },
        { icon: 'bi-fingerprint', name: 'MFA coverage', meta: '100% of users, 8 hardware keys', status: 'ok' },
        { icon: 'bi-person-dash', name: 'Leaver, Friday', meta: 'Accounts, licences and badge revoked', status: 'ok' },
        { icon: 'bi-clipboard-check', name: 'Quarterly access review', meta: 'Owners notified', status: 'scheduled' },
      ],
      nextLabel: 'Next access review',
      nextValue: 'In 9 days',
    },
    sceneLabel: $localize`:@@featureForepathItService-identitySceneLabel:ForePath operations board for identity and access: directory sync, MFA coverage, a completed offboarding and an upcoming access review`,
    advantages: [
      {
        icon: 'bi-person-plus',
        title: $localize`:@@featureForepathItService-identityAdvantage1Title:Fast onboarding`,
        description: $localize`:@@featureForepathItService-identityAdvantage1Desc:New colleagues get exactly the access their role needs, on their first day.`,
      },
      {
        icon: 'bi-person-dash',
        title: $localize`:@@featureForepathItService-identityAdvantage2Title:Clean offboarding`,
        description: $localize`:@@featureForepathItService-identityAdvantage2Desc:Accounts, licences, and badges are revoked on the day someone leaves.`,
      },
      {
        icon: 'bi-fingerprint',
        title: $localize`:@@featureForepathItService-identityAdvantage3Title:Strong sign-in`,
        description: $localize`:@@featureForepathItService-identityAdvantage3Desc:Multi-factor authentication and single sign-on reduce the risk of stolen passwords.`,
      },
      {
        icon: 'bi-clipboard-check',
        title: $localize`:@@featureForepathItService-identityAdvantage4Title:Audit-ready records`,
        description: $localize`:@@featureForepathItService-identityAdvantage4Desc:Regular access reviews leave a trail that auditors and insurers can follow.`,
      },
    ],
    solutions: [
      {
        id: 'entra-active-directory',
        icon: 'bi-people',
        title: $localize`:@@featureForepathItService-identitySolution1Title:Entra ID and Active Directory Managed`,
        description: $localize`:@@featureForepathItService-identitySolution1Desc:Hybrid identity across on-premises Active Directory and Microsoft Entra ID, with conditional access, MFA, and group-based permissions.`,
        items: [
          $localize`:@@featureForepathItService-identitySolution1Item1:Directory clean-up, group design, and role-based access`,
          $localize`:@@featureForepathItService-identitySolution1Item2:Conditional access and multi-factor authentication rollout`,
          $localize`:@@featureForepathItService-identitySolution1Item3:Joiner, mover, and leaver processes tied to HR`,
        ],
      },
      {
        id: 'sso-mfa',
        icon: 'bi-key',
        title: $localize`:@@featureForepathItService-identitySolution2Title:Single sign-on and MFA`,
        description: $localize`:@@featureForepathItService-identitySolution2Desc:Single sign-on for cloud and business applications plus app-based or hardware second factors, including for VPN and remote access.`,
        items: [
          $localize`:@@featureForepathItService-identitySolution2Item1:Single sign-on for cloud and internal applications`,
          $localize`:@@featureForepathItService-identitySolution2Item2:MFA for VPN, remote desktop, and admin access`,
          $localize`:@@featureForepathItService-identitySolution2Item3:Privileged account monitoring and periodic recertification`,
        ],
      },
      {
        id: 'physical-access',
        icon: 'bi-door-closed',
        title: $localize`:@@featureForepathItService-identitySolution3Title:Physical access control`,
        description: $localize`:@@featureForepathItService-identitySolution3Desc:Badge and door access tied to the same joiner and leaver process as digital accounts.`,
        items: [
          $localize`:@@featureForepathItService-identitySolution3Item1:Badge and door access provisioning with audit trails`,
          $localize`:@@featureForepathItService-identitySolution3Item2:Time-based access profiles for staff, visitors, and contractors`,
          $localize`:@@featureForepathItService-identitySolution3Item3:Revocation in step with account offboarding`,
        ],
      },
    ],
    ctaTitle: $localize`:@@featureForepathItService-identityCtaTitle:Do you know who can access what?`,
    ctaLead: $localize`:@@featureForepathItService-identityCtaLead:Tell us about your directories, applications, and doors. We will start with an access review and propose how to keep it clean from then on.`,
  },
  {
    id: 'security',
    route: '/it-systems/security',
    icon: 'bi-shield-lock',
    title: $localize`:@@featureForepathItService-securityTitle:Security and protection`,
    navCaption: $localize`:@@featureForepathItService-securityNavCaption:Endpoint protection, patching, and response`,
    metaTitle: $localize`:@@featureForepathItService-securityMetaTitle:Managed IT security :: ForePath`,
    metaDescription: $localize`:@@featureForepathItService-securityMetaDescription:ForePath protects endpoints, users, and data with Microsoft Defender, managed firewalls, patch management, and practiced incident response.`,
    metaKeywords: $localize`:@@featureForepathItService-securityMetaKeywords:managed security, Microsoft Defender, endpoint protection, patch management, incident response, Fortinet, Cloudflare`,
    heroAccent: $localize`:@@featureForepathItService-securityHeroAccent:Security`,
    heroRest: $localize`:@@featureForepathItService-securityHeroRest:that works every day, not only on paper`,
    heroLead: $localize`:@@featureForepathItService-securityHeroLead:Layered controls, steady patching, and a documented response process protect your endpoints, users, and data.`,
    logoSlots: [
      [LOGOS.microsoft, LOGOS.ubuntu],
      [LOGOS.fortinet],
      [LOGOS.opnsense, LOGOS.windowsserver],
      [LOGOS.cloudflare],
    ],
    valueTitle: $localize`:@@featureForepathItService-securityValueTitle:Protection without paralysis`,
    valueLead: $localize`:@@featureForepathItService-securityValueLead:Good security keeps attackers out without slowing your people down. We combine sensible defaults, steady patching, and practiced response so incidents stay small.`,
    scene: {
      title: 'Security and protection',
      items: [
        { icon: 'bi-shield-check', name: 'Microsoft Defender', meta: '86 endpoints protected', status: 'ok' },
        { icon: 'bi-envelope-exclamation', name: 'Phishing reports', meta: '3 this week, all triaged', status: 'ok' },
        {
          icon: 'bi-arrow-repeat',
          name: 'Patch compliance',
          meta: '97%, 4 devices pending reboot',
          status: 'attention',
        },
        { icon: 'bi-bricks', name: 'Perimeter firewall', meta: 'IPS signatures updated today', status: 'ok' },
      ],
      nextLabel: 'Next security review',
      nextValue: 'Thursday, 10:00',
    },
    sceneLabel: $localize`:@@featureForepathItService-securitySceneLabel:ForePath operations board for IT security: Microsoft Defender, triaged phishing reports, patch compliance with devices pending reboot and an updated firewall`,
    advantages: [
      {
        icon: 'bi-layers',
        title: $localize`:@@featureForepathItService-securityAdvantage1Title:Layered defence`,
        description: $localize`:@@featureForepathItService-securityAdvantage1Desc:Firewall, endpoint, email, and identity controls back each other up.`,
      },
      {
        icon: 'bi-arrow-repeat',
        title: $localize`:@@featureForepathItService-securityAdvantage2Title:Patch status you can prove`,
        description: $localize`:@@featureForepathItService-securityAdvantage2Desc:Regular reports show which systems are current and which need attention.`,
      },
      {
        icon: 'bi-lightning',
        title: $localize`:@@featureForepathItService-securityAdvantage3Title:Fast, practiced response`,
        description: $localize`:@@featureForepathItService-securityAdvantage3Desc:Runbooks define who does what when an alert or a phishing report comes in.`,
      },
      {
        icon: 'bi-mortarboard',
        title: $localize`:@@featureForepathItService-securityAdvantage4Title:People as a line of defence`,
        description: $localize`:@@featureForepathItService-securityAdvantage4Desc:Awareness training turns employees into reliable reporters of phishing attempts.`,
      },
    ],
    solutions: [
      {
        id: 'microsoft-defender',
        icon: 'bi-shield-check',
        title: $localize`:@@featureForepathItService-securitySolution1Title:Microsoft Defender Managed`,
        description: $localize`:@@featureForepathItService-securitySolution1Desc:Microsoft Defender for endpoints and email, configured, tuned, and watched. It is part of several Microsoft 365 plans you may already pay for.`,
        items: [
          $localize`:@@featureForepathItService-securitySolution1Item1:Endpoint detection and antivirus policy management`,
          $localize`:@@featureForepathItService-securitySolution1Item2:Email protection against phishing and malicious attachments`,
          $localize`:@@featureForepathItService-securitySolution1Item3:Alert triage with clear escalation to your team`,
        ],
      },
      {
        id: 'perimeter',
        icon: 'bi-bricks',
        title: $localize`:@@featureForepathItService-securitySolution2Title:Perimeter and web protection`,
        description: $localize`:@@featureForepathItService-securitySolution2Desc:Firewalls with intrusion prevention and web filtering, plus Cloudflare in front of your public websites and applications.`,
        items: [
          $localize`:@@featureForepathItService-securitySolution2Item1:Intrusion prevention and web filtering policies`,
          $localize`:@@featureForepathItService-securitySolution2Item2:DDoS protection and web application firewall for public services`,
          $localize`:@@featureForepathItService-securitySolution2Item3:Regular rule and exposure reviews`,
        ],
      },
      {
        id: 'patch-management',
        icon: 'bi-arrow-repeat',
        title: $localize`:@@featureForepathItService-securitySolution3Title:Patch and vulnerability management`,
        description: $localize`:@@featureForepathItService-securitySolution3Desc:Operating systems and third-party applications patched on a fixed cycle, with vulnerability scans that show what is left.`,
        items: [
          $localize`:@@featureForepathItService-securitySolution3Item1:Security patch compliance with regular reporting`,
          $localize`:@@featureForepathItService-securitySolution3Item2:Remediation prioritized by real exposure`,
          $localize`:@@featureForepathItService-securitySolution3Item3:Emergency patching when critical vulnerabilities appear`,
        ],
      },
      {
        id: 'incident-response',
        icon: 'bi-life-preserver',
        title: $localize`:@@featureForepathItService-securitySolution4Title:Incident response readiness`,
        description: $localize`:@@featureForepathItService-securitySolution4Desc:Runbooks, contact chains, and drills, so a security incident becomes a process instead of a panic.`,
        items: [
          $localize`:@@featureForepathItService-securitySolution4Item1:Phishing triage and incident response runbooks`,
          $localize`:@@featureForepathItService-securitySolution4Item2:Contact chains for insurers, authorities, and partners`,
          $localize`:@@featureForepathItService-securitySolution4Item3:Tabletop exercises with your leadership team`,
        ],
      },
    ],
    ctaTitle: $localize`:@@featureForepathItService-securityCtaTitle:How well protected are you today?`,
    ctaLead: $localize`:@@featureForepathItService-securityCtaLead:Tell us about your systems and what worries you most. We will start with a short assessment and propose the controls that matter first.`,
  },
  {
    id: 'resilience',
    route: '/it-systems/resilience',
    icon: 'bi-graph-up',
    title: $localize`:@@featureForepathItService-resilienceTitle:Resilience and operations`,
    navCaption: $localize`:@@featureForepathItService-resilienceNavCaption:Backup, archiving, monitoring, and power`,
    metaTitle: $localize`:@@featureForepathItService-resilienceMetaTitle:Managed backup, archiving, and monitoring :: ForePath`,
    metaDescription: $localize`:@@featureForepathItService-resilienceMetaDescription:ForePath runs backups with restore drills, MailStore email archiving, UPS power protection, and monitoring with monthly health reports.`,
    metaKeywords: $localize`:@@featureForepathItService-resilienceMetaKeywords:managed backup, Proxmox Backup Server, MailStore, email archiving, APC UPS, monitoring, disaster recovery`,
    heroAccent: $localize`:@@featureForepathItService-resilienceHeroAccent:Resilience`,
    heroRest: $localize`:@@featureForepathItService-resilienceHeroRest:that is tested before you need it`,
    heroLead: $localize`:@@featureForepathItService-resilienceHeroLead:Backup, archiving, monitoring, and power protection are tuned so issues surface early and recovery targets stay achievable.`,
    logoSlots: [[LOGOS.proxmox], [LOGOS.mailstore, LOGOS.microsoft], [LOGOS.apc], [LOGOS.ceph, LOGOS.influxdb]],
    valueTitle: $localize`:@@featureForepathItService-resilienceValueTitle:Ready for the bad day`,
    valueLead: $localize`:@@featureForepathItService-resilienceValueLead:Hardware fails, files get deleted, and power goes out. What matters is how fast you are back. We plan for those moments and rehearse them, so recovery is routine.`,
    scene: {
      title: 'Resilience and operations',
      items: [
        { icon: 'bi-cloud-arrow-up', name: 'Nightly backup', meta: '64 of 64 VMs, offsite copy synced', status: 'ok' },
        { icon: 'bi-archive', name: 'MailStore archive', meta: '1.2 million messages, retention active', status: 'ok' },
        {
          icon: 'bi-battery-charging',
          name: 'UPS, server room',
          meta: 'Battery 100%, 42 minutes runtime',
          status: 'ok',
        },
        {
          icon: 'bi-arrow-counterclockwise',
          name: 'Restore drill',
          meta: 'File server and ERP database',
          status: 'scheduled',
        },
      ],
      nextLabel: 'Next restore drill',
      nextValue: 'Thursday, 14:00',
    },
    sceneLabel: $localize`:@@featureForepathItService-resilienceSceneLabel:ForePath operations board for resilience: nightly backups, MailStore archive, UPS status and the next scheduled restore drill`,
    advantages: [
      {
        icon: 'bi-arrow-counterclockwise',
        title: $localize`:@@featureForepathItService-resilienceAdvantage1Title:Restores that are proven`,
        description: $localize`:@@featureForepathItService-resilienceAdvantage1Desc:Scheduled restore drills show that backups actually bring data back.`,
      },
      {
        icon: 'bi-bell',
        title: $localize`:@@featureForepathItService-resilienceAdvantage2Title:Alerts that matter`,
        description: $localize`:@@featureForepathItService-resilienceAdvantage2Desc:Tuned thresholds cut the noise, so real issues get attention fast.`,
      },
      {
        icon: 'bi-file-earmark-lock',
        title: $localize`:@@featureForepathItService-resilienceAdvantage3Title:Compliant archiving`,
        description: $localize`:@@featureForepathItService-resilienceAdvantage3Desc:Email is archived completely and tamper-proof to meet retention duties.`,
      },
      {
        icon: 'bi-bar-chart-line',
        title: $localize`:@@featureForepathItService-resilienceAdvantage4Title:Transparent operations`,
        description: $localize`:@@featureForepathItService-resilienceAdvantage4Desc:Monthly health reports show SLA performance, incidents, and trends.`,
      },
    ],
    solutions: [
      {
        id: 'backup',
        icon: 'bi-cloud-arrow-up',
        title: $localize`:@@featureForepathItService-resilienceSolution1Title:Managed backup with Proxmox Backup Server`,
        description: $localize`:@@featureForepathItService-resilienceSolution1Desc:Incremental, deduplicated, and encrypted backups of virtual machines and servers, with an offsite copy and regular restore tests.`,
        items: [
          $localize`:@@featureForepathItService-resilienceSolution1Item1:Backup monitoring with scheduled restore drills`,
          $localize`:@@featureForepathItService-resilienceSolution1Item2:Offsite and immutable copies against ransomware`,
          $localize`:@@featureForepathItService-resilienceSolution1Item3:Recovery targets agreed and documented per system`,
        ],
      },
      {
        id: 'mailstore',
        icon: 'bi-archive',
        title: $localize`:@@featureForepathItService-resilienceSolution2Title:Email archiving with MailStore`,
        description: $localize`:@@featureForepathItService-resilienceSolution2Desc:Complete, tamper-proof archiving of all business email from Microsoft 365, Exchange, and other mail servers, supporting legal retention duties such as GoBD.`,
        items: [
          $localize`:@@featureForepathItService-resilienceSolution2Item1:Incoming and outgoing email archived from day one`,
          $localize`:@@featureForepathItService-resilienceSolution2Item2:Fast full-text search for users and auditors`,
          $localize`:@@featureForepathItService-resilienceSolution2Item3:Retention policies aligned with legal requirements`,
        ],
      },
      {
        id: 'power',
        icon: 'bi-battery-charging',
        title: $localize`:@@featureForepathItService-resilienceSolution3Title:Power protection with APC`,
        description: $localize`:@@featureForepathItService-resilienceSolution3Desc:Uninterruptible power supplies sized for your racks and network closets, monitored and wired for a controlled shutdown.`,
        items: [
          $localize`:@@featureForepathItService-resilienceSolution3Item1:UPS sizing and battery runtime planning`,
          $localize`:@@featureForepathItService-resilienceSolution3Item2:Monitoring of power events and battery health`,
          $localize`:@@featureForepathItService-resilienceSolution3Item3:Automated, graceful shutdown of servers and storage`,
        ],
      },
      {
        id: 'monitoring',
        icon: 'bi-activity',
        title: $localize`:@@featureForepathItService-resilienceSolution4Title:Monitoring and operational reporting`,
        description: $localize`:@@featureForepathItService-resilienceSolution4Desc:Central monitoring of servers, networks, services, and certificates, with alert routing and monthly operational health reports.`,
        items: [
          $localize`:@@featureForepathItService-resilienceSolution4Item1:Alert threshold tuning to reduce noise and fatigue`,
          $localize`:@@featureForepathItService-resilienceSolution4Item2:SLA aligned ticket routing with monthly operational health reports`,
          $localize`:@@featureForepathItService-resilienceSolution4Item3:Certificate and licence expiry tracking`,
        ],
      },
    ],
    ctaTitle: $localize`:@@featureForepathItService-resilienceCtaTitle:When did you last test a restore?`,
    ctaLead: $localize`:@@featureForepathItService-resilienceCtaLead:Tell us how you back up, archive, and monitor today. We will propose recovery targets and the operating scope to meet them.`,
  },
];

export function forepathItServiceById(id: ForepathItServiceId): ForepathItService {
  const service = FOREPATH_IT_SERVICES.find((candidate) => candidate.id === id);

  if (!service) {
    throw new Error(`Unknown ForePath IT service: ${id}`);
  }

  return service;
}
