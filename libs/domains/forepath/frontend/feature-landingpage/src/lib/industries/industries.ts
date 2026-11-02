import type { ForepathOneThread } from '../forepath-one-teaser/forepath-one-teaser.component';

export type ForepathIndustryId =
  | 'manufacturing'
  | 'logistics'
  | 'retail'
  | 'healthcare'
  | 'professional-services'
  | 'software';

export interface ForepathIndustryChallenge {
  icon: string;
  title: string;
  description: string;
}

/** One way ForePath helps, shown as a card next to the industry photo. */
export interface ForepathIndustryFitItem {
  icon: string;
  text: string;
}

/** Cross link from a solution to the offering page (or product site) it is built on. */
export interface ForepathIndustrySolutionLink {
  label: string;
  route?: string;
  fragment?: string;
  href?: string;
}

export interface ForepathIndustrySolution {
  id: string;
  icon: string;
  title: string;
  description: string;
  items: readonly string[];
  link: ForepathIndustrySolutionLink;
}

export interface ForepathIndustry {
  id: ForepathIndustryId;
  route: string;
  icon: string;
  title: string;
  /** One line under the title in the industries menu. */
  navCaption: string;
  metaTitle: string;
  metaDescription: string;
  metaKeywords: string;
  heroAccent: string;
  heroRest: string;
  heroLead: string;
  challengesTitle: string;
  challengesLead: string;
  challenges: readonly ForepathIndustryChallenge[];
  /** Stock photo (Pexels licence) next to the fit cards, like the home page's human meets machine photo. */
  photoUrl: string;
  photoLabel: string;
  fitTitle: string;
  fitLead: string;
  fitItems: readonly ForepathIndustryFitItem[];
  solutions: readonly ForepathIndustrySolution[];
  /** The ForePath One thread this industry leans on most. */
  oneThread: ForepathOneThread;
  ctaTitle: string;
  ctaLead: string;
}

// Links shared by several industries, so labels stay identical to the pages they point to.
const LINKS = {
  consulting: { label: $localize`:@@featureForepathIndustry-linkConsulting:Consulting`, route: '/consulting' },
  development: {
    label: $localize`:@@featureForepathIndustry-linkDevelopment:Software development`,
    route: '/software-development',
  },
  network: {
    label: $localize`:@@featureForepathIndustry-linkNetwork:Network and connectivity`,
    route: '/it-systems/network',
  },
  workplace: {
    label: $localize`:@@featureForepathIndustry-linkWorkplace:Endpoints and workplace`,
    route: '/it-systems/workplace',
  },
  identity: {
    label: $localize`:@@featureForepathIndustry-linkIdentity:Identity and access`,
    route: '/it-systems/identity',
  },
  security: {
    label: $localize`:@@featureForepathIndustry-linkSecurity:Security and protection`,
    route: '/it-systems/security',
  },
  resilience: {
    label: $localize`:@@featureForepathIndustry-linkResilience:Resilience and operations`,
    route: '/it-systems/resilience',
  },
  agenstra: { label: 'agenstra.com', href: 'https://agenstra.com' },
  decabill: { label: 'decabill.com', href: 'https://decabill.com' },
  loadweaver: { label: 'loadweaver.com', href: 'https://loadweaver.com' },
} as const satisfies Record<string, ForepathIndustrySolutionLink>;

// The industries we serve, in the order of the industries menu and the footer.
export const FOREPATH_INDUSTRIES: readonly ForepathIndustry[] = [
  {
    id: 'manufacturing',
    route: '/industries/manufacturing',
    icon: 'bi-gear-wide-connected',
    title: $localize`:@@featureForepathIndustry-manufacturingTitle:Manufacturing`,
    navCaption: $localize`:@@featureForepathIndustry-manufacturingNavCaption:Plants, production IT, and ERP integrations`,
    metaTitle: $localize`:@@featureForepathIndustry-manufacturingMetaTitle:IT and software for manufacturing companies :: ForePath`,
    metaDescription: $localize`:@@featureForepathIndustry-manufacturingMetaDescription:ForePath plans, builds, and operates IT for manufacturers: production networks, servers and backups for shift operations, ERP integrations, and modernization roadmaps.`,
    metaKeywords: $localize`:@@featureForepathIndustry-manufacturingMetaKeywords:manufacturing IT, production network, ERP integration, MES, Mittelstand, shop floor security, managed IT`,
    heroAccent: $localize`:@@featureForepathIndustry-manufacturingHeroAccent:Manufacturing IT`,
    heroRest: $localize`:@@featureForepathIndustry-manufacturingHeroRest:that keeps the line running`,
    heroLead: $localize`:@@featureForepathIndustry-manufacturingHeroLead:We connect shop floor, office, and ERP with networks, platforms, and software built for production hours, not office hours.`,
    challengesTitle: $localize`:@@featureForepathIndustry-manufacturingChallengesTitle:Where production IT gets hard`,
    challengesLead: $localize`:@@featureForepathIndustry-manufacturingChallengesLead:Factories run on systems that grew over decades. Machines, ERP, and office IT have to work together, and every outage shows up on the delivery schedule.`,
    challenges: [
      {
        icon: 'bi-diagram-3',
        title: $localize`:@@featureForepathIndustry-manufacturingChallenge1Title:One flat network for everything`,
        description: $localize`:@@featureForepathIndustry-manufacturingChallenge1Desc:Machines, scanners, and office devices often share a network that nobody dares to touch.`,
      },
      {
        icon: 'bi-hourglass-split',
        title: $localize`:@@featureForepathIndustry-manufacturingChallenge2Title:Downtime costs output`,
        description: $localize`:@@featureForepathIndustry-manufacturingChallenge2Desc:A failed server or switch stops more than email. It stops orders, labels, and shipments.`,
      },
      {
        icon: 'bi-plug',
        title: $localize`:@@featureForepathIndustry-manufacturingChallenge3Title:Systems that do not talk`,
        description: $localize`:@@featureForepathIndustry-manufacturingChallenge3Desc:ERP, MES, and spreadsheets hold the same data in different versions.`,
      },
      {
        icon: 'bi-shield-exclamation',
        title: $localize`:@@featureForepathIndustry-manufacturingChallenge4Title:Older machines, newer threats`,
        description: $localize`:@@featureForepathIndustry-manufacturingChallenge4Desc:Machine PCs and controllers run software that cannot be patched like an office laptop.`,
      },
    ],
    photoUrl: '/assets/images/industries/manufacturing.jpg',
    photoLabel: $localize`:@@featureForepathIndustry-manufacturingPhotoLabel:Engineers in a production hall reviewing data on a tablet`,
    fitTitle: $localize`:@@featureForepathIndustry-manufacturingFitTitle:Built for the plant floor and the office`,
    fitLead: $localize`:@@featureForepathIndustry-manufacturingFitLead:We advise, build, and operate the systems a manufacturer depends on, from the network in the hall to the integration behind every order.`,
    fitItems: [
      {
        icon: 'bi-hdd-network',
        text: $localize`:@@featureForepathIndustry-manufacturingFit1:Segmented networks keep production, office, and guest traffic apart, with Wi-Fi planned for halls and warehouses.`,
      },
      {
        icon: 'bi-server',
        text: $localize`:@@featureForepathIndustry-manufacturingFit2:Servers and backups are sized for shift operations, patched in agreed windows, and restored in regular drills.`,
      },
      {
        icon: 'bi-plug',
        text: $localize`:@@featureForepathIndustry-manufacturingFit3:Integrations connect ERP, MES, and shop floor data, so planning works from one set of numbers.`,
      },
      {
        icon: 'bi-compass',
        text: $localize`:@@featureForepathIndustry-manufacturingFit4:Architecture reviews give you a modernization roadmap that fits your maintenance calendar.`,
      },
    ],
    solutions: [
      {
        id: 'production-networks',
        icon: 'bi-hdd-network',
        title: $localize`:@@featureForepathIndustry-manufacturingSolution1Title:Production networks and Wi-Fi`,
        description: $localize`:@@featureForepathIndustry-manufacturingSolution1Desc:Segmented networks for machines, office, and guests, with firewalls between them and Wi-Fi that covers halls and yards.`,
        items: [
          $localize`:@@featureForepathIndustry-manufacturingSolution1Item1:Network zones for production, office, and IoT devices`,
          $localize`:@@featureForepathIndustry-manufacturingSolution1Item2:Firewall rules between shop floor and office IT`,
          $localize`:@@featureForepathIndustry-manufacturingSolution1Item3:Wi-Fi surveys for halls, warehouses, and yards`,
        ],
        link: { ...LINKS.network, fragment: 'managed-switching' },
      },
      {
        id: 'shift-operations',
        icon: 'bi-server',
        title: $localize`:@@featureForepathIndustry-manufacturingSolution2Title:Servers and backups for shift operations`,
        description: $localize`:@@featureForepathIndustry-manufacturingSolution2Desc:Virtualization, storage, and backups run with patch windows that respect your shifts and restore drills that prove recovery.`,
        items: [
          $localize`:@@featureForepathIndustry-manufacturingSolution2Item1:Patch windows planned around production shifts`,
          $localize`:@@featureForepathIndustry-manufacturingSolution2Item2:Restore drills for ERP and file servers`,
          $localize`:@@featureForepathIndustry-manufacturingSolution2Item3:UPS protection with a controlled shutdown`,
        ],
        link: { ...LINKS.resilience, fragment: 'backup' },
      },
      {
        id: 'erp-integrations',
        icon: 'bi-plug',
        title: $localize`:@@featureForepathIndustry-manufacturingSolution3Title:ERP and shop floor integrations`,
        description: $localize`:@@featureForepathIndustry-manufacturingSolution3Desc:Interfaces between ERP, MES, machines, and partner portals, built with tests and documentation your team can maintain.`,
        items: [
          $localize`:@@featureForepathIndustry-manufacturingSolution3Item1:Order, stock, and production data in sync`,
          $localize`:@@featureForepathIndustry-manufacturingSolution3Item2:Interfaces to supplier and customer portals`,
          $localize`:@@featureForepathIndustry-manufacturingSolution3Item3:Handover with documentation and runbooks`,
        ],
        link: LINKS.development,
      },
      {
        id: 'modernization-roadmap',
        icon: 'bi-compass',
        title: $localize`:@@featureForepathIndustry-manufacturingSolution4Title:Modernization and security roadmap`,
        description: $localize`:@@featureForepathIndustry-manufacturingSolution4Desc:An independent review of your IT and production systems, with a roadmap ordered by risk and effort.`,
        items: [
          $localize`:@@featureForepathIndustry-manufacturingSolution4Item1:Inventory of systems, dependencies, and risks`,
          $localize`:@@featureForepathIndustry-manufacturingSolution4Item2:Security baseline for production and office IT`,
          $localize`:@@featureForepathIndustry-manufacturingSolution4Item3:Roadmap with effort ranges and sequencing`,
        ],
        link: LINKS.consulting,
      },
    ],
    oneThread: 'it-systems',
    ctaTitle: $localize`:@@featureForepathIndustry-manufacturingCtaTitle:Planning the next step for your plant?`,
    ctaLead: $localize`:@@featureForepathIndustry-manufacturingCtaLead:Tell us about your sites, systems, and production hours. We will propose a scope that fits your maintenance calendar.`,
  },
  {
    id: 'logistics',
    route: '/industries/logistics',
    icon: 'bi-truck',
    title: $localize`:@@featureForepathIndustry-logisticsTitle:Logistics and wholesale`,
    navCaption: $localize`:@@featureForepathIndustry-logisticsNavCaption:Warehouses, depots, and connected partners`,
    metaTitle: $localize`:@@featureForepathIndustry-logisticsMetaTitle:IT and integrations for logistics and wholesale :: ForePath`,
    metaDescription: $localize`:@@featureForepathIndustry-logisticsMetaDescription:ForePath connects warehouses and depots with reliable Wi-Fi and site networks, builds carrier and partner integrations, and monitors the systems behind every shift.`,
    metaKeywords: $localize`:@@featureForepathIndustry-logisticsMetaKeywords:logistics IT, warehouse Wi-Fi, wholesale, carrier integration, EDI, site networking, managed IT`,
    heroAccent: $localize`:@@featureForepathIndustry-logisticsHeroAccent:Logistics`,
    heroRest: $localize`:@@featureForepathIndustry-logisticsHeroRest:where every scan reaches the system`,
    heroLead: $localize`:@@featureForepathIndustry-logisticsHeroLead:We keep warehouses, depots, and offices connected and build the integrations that move orders between you, your carriers, and your customers.`,
    challengesTitle: $localize`:@@featureForepathIndustry-logisticsChallengesTitle:What slows logistics down`,
    challengesLead: $localize`:@@featureForepathIndustry-logisticsChallengesLead:Goods move around the clock, and so does the data about them. When a scanner, a link, or an interface fails, trucks wait.`,
    challenges: [
      {
        icon: 'bi-wifi-off',
        title: $localize`:@@featureForepathIndustry-logisticsChallenge1Title:Gaps in warehouse Wi-Fi`,
        description: $localize`:@@featureForepathIndustry-logisticsChallenge1Desc:Handheld scanners drop out between racks and at the loading docks.`,
      },
      {
        icon: 'bi-buildings',
        title: $localize`:@@featureForepathIndustry-logisticsChallenge2Title:Many sites, no standard`,
        description: $localize`:@@featureForepathIndustry-logisticsChallenge2Desc:Depots and branches grew with different equipment and no shared documentation.`,
      },
      {
        icon: 'bi-arrow-left-right',
        title: $localize`:@@featureForepathIndustry-logisticsChallenge3Title:Interfaces to every partner`,
        description: $localize`:@@featureForepathIndustry-logisticsChallenge3Desc:Carriers, marketplaces, and customers each expect their own formats and portals.`,
      },
      {
        icon: 'bi-clock-history',
        title: $localize`:@@featureForepathIndustry-logisticsChallenge4Title:Operations that never stop`,
        description: $localize`:@@featureForepathIndustry-logisticsChallenge4Desc:Night shifts and weekends need monitoring and a clear escalation path outside office hours.`,
      },
    ],
    photoUrl: '/assets/images/industries/logistics.jpg',
    photoLabel: $localize`:@@featureForepathIndustry-logisticsPhotoLabel:Warehouse employee checking stock on a tablet between pallet racks`,
    fitTitle: $localize`:@@featureForepathIndustry-logisticsFitTitle:Connected from dock to dashboard`,
    fitLead: $localize`:@@featureForepathIndustry-logisticsFitLead:We advise, build, and operate the systems that keep goods and data moving together, across every site.`,
    fitItems: [
      {
        icon: 'bi-wifi',
        text: $localize`:@@featureForepathIndustry-logisticsFit1:Wi-Fi planned from site surveys covers racks, docks, and yards, so scanners stay online.`,
      },
      {
        icon: 'bi-buildings',
        text: $localize`:@@featureForepathIndustry-logisticsFit2:Sites are connected through managed firewalls and VPNs on one documented standard.`,
      },
      {
        icon: 'bi-arrow-left-right',
        text: $localize`:@@featureForepathIndustry-logisticsFit3:Integrations exchange orders, stock, and tracking data with carriers, shops, and customers.`,
      },
      {
        icon: 'bi-activity',
        text: $localize`:@@featureForepathIndustry-logisticsFit4:Monitoring and alert routing catch failures before the next shift does.`,
      },
    ],
    solutions: [
      {
        id: 'warehouse-networks',
        icon: 'bi-wifi',
        title: $localize`:@@featureForepathIndustry-logisticsSolution1Title:Warehouse Wi-Fi and site networks`,
        description: $localize`:@@featureForepathIndustry-logisticsSolution1Desc:Wi-Fi for racks, docks, and yards plus firewalls and site-to-site VPN that connect every depot on the same network standard.`,
        items: [
          $localize`:@@featureForepathIndustry-logisticsSolution1Item1:Site surveys and access point placement for warehouses`,
          $localize`:@@featureForepathIndustry-logisticsSolution1Item2:Site-to-site VPN between depots and headquarters`,
          $localize`:@@featureForepathIndustry-logisticsSolution1Item3:Separate networks for scanners, office, and guests`,
        ],
        link: { ...LINKS.network, fragment: 'managed-switching' },
      },
      {
        id: 'partner-integrations',
        icon: 'bi-arrow-left-right',
        title: $localize`:@@featureForepathIndustry-logisticsSolution2Title:Carrier and partner integrations`,
        description: $localize`:@@featureForepathIndustry-logisticsSolution2Desc:Interfaces between your warehouse management, ERP, carriers, and marketplaces, built with automated tests and monitoring.`,
        items: [
          $localize`:@@featureForepathIndustry-logisticsSolution2Item1:Order, stock, and tracking data exchanged automatically`,
          $localize`:@@featureForepathIndustry-logisticsSolution2Item2:Customer and partner portals on modern stacks`,
          $localize`:@@featureForepathIndustry-logisticsSolution2Item3:Alerts when a transfer fails, not when a customer calls`,
        ],
        link: LINKS.development,
      },
      {
        id: 'shift-monitoring',
        icon: 'bi-activity',
        title: $localize`:@@featureForepathIndustry-logisticsSolution3Title:Monitoring for every shift`,
        description: $localize`:@@featureForepathIndustry-logisticsSolution3Desc:Central monitoring of servers, networks, and interfaces, with alerts routed to the right people and monthly health reports.`,
        items: [
          $localize`:@@featureForepathIndustry-logisticsSolution3Item1:Alert routing for night and weekend shifts`,
          $localize`:@@featureForepathIndustry-logisticsSolution3Item2:Backups with restore drills for warehouse systems`,
          $localize`:@@featureForepathIndustry-logisticsSolution3Item3:Monthly reports on incidents and trends`,
        ],
        link: { ...LINKS.resilience, fragment: 'monitoring' },
      },
      {
        id: 'devices',
        icon: 'bi-upc-scan',
        title: $localize`:@@featureForepathIndustry-logisticsSolution4Title:Devices for office and warehouse`,
        description: $localize`:@@featureForepathIndustry-logisticsSolution4Desc:Laptops, tablets, and accessories rolled out on one baseline, bought or rented monthly through topi.`,
        items: [
          $localize`:@@featureForepathIndustry-logisticsSolution4Item1:Standardized devices for office and warehouse staff`,
          $localize`:@@featureForepathIndustry-logisticsSolution4Item2:Monthly rental instead of upfront purchases`,
          $localize`:@@featureForepathIndustry-logisticsSolution4Item3:Devices for seasonal staff without a new capital cycle`,
        ],
        link: { ...LINKS.workplace, fragment: 'workplace-rental' },
      },
    ],
    oneThread: 'development',
    ctaTitle: $localize`:@@featureForepathIndustry-logisticsCtaTitle:Where does your data get stuck?`,
    ctaLead: $localize`:@@featureForepathIndustry-logisticsCtaLead:Tell us about your sites, systems, and partners. We will propose where to start, from warehouse Wi-Fi to a new carrier interface.`,
  },
  {
    id: 'retail',
    route: '/industries/retail',
    icon: 'bi-shop',
    title: $localize`:@@featureForepathIndustry-retailTitle:Retail and e-commerce`,
    navCaption: $localize`:@@featureForepathIndustry-retailNavCaption:Stores, online shops, and checkout`,
    metaTitle: $localize`:@@featureForepathIndustry-retailMetaTitle:IT and software for retail and e-commerce :: ForePath`,
    metaDescription: $localize`:@@featureForepathIndustry-retailMetaDescription:ForePath builds shop and marketplace integrations, protects online shops with Cloudflare, and runs store networks, so checkout, stock, and orders stay in sync.`,
    metaKeywords: $localize`:@@featureForepathIndustry-retailMetaKeywords:retail IT, e-commerce, online shop development, marketplace integration, store network, Cloudflare, managed IT`,
    heroAccent: $localize`:@@featureForepathIndustry-retailHeroAccent:Retail`,
    heroRest: $localize`:@@featureForepathIndustry-retailHeroRest:that sells in store and online without friction`,
    heroLead: $localize`:@@featureForepathIndustry-retailHeroLead:We build and operate the shops, store networks, and integrations behind your checkout, so stock, orders, and payments stay in sync.`,
    challengesTitle: $localize`:@@featureForepathIndustry-retailChallengesTitle:What makes retail IT demanding`,
    challengesLead: $localize`:@@featureForepathIndustry-retailChallengesLead:Customers expect the same prices, stock, and service in every channel. Behind the counter, that means many systems that have to agree.`,
    challenges: [
      {
        icon: 'bi-shuffle',
        title: $localize`:@@featureForepathIndustry-retailChallenge1Title:Channels out of sync`,
        description: $localize`:@@featureForepathIndustry-retailChallenge1Desc:Store, online shop, and marketplaces show different stock and prices.`,
      },
      {
        icon: 'bi-graph-up-arrow',
        title: $localize`:@@featureForepathIndustry-retailChallenge2Title:Peaks you cannot miss`,
        description: $localize`:@@featureForepathIndustry-retailChallenge2Desc:Sales, holidays, and campaigns bring traffic that has to work on the first try.`,
      },
      {
        icon: 'bi-credit-card',
        title: $localize`:@@featureForepathIndustry-retailChallenge3Title:Checkout must always work`,
        description: $localize`:@@featureForepathIndustry-retailChallenge3Desc:When the store network or a payment terminal fails, the queue grows by the minute.`,
      },
      {
        icon: 'bi-shield-lock',
        title: $localize`:@@featureForepathIndustry-retailChallenge4Title:Customer data to protect`,
        description: $localize`:@@featureForepathIndustry-retailChallenge4Desc:Online accounts and orders attract attacks and come with data protection duties.`,
      },
    ],
    photoUrl: '/assets/images/industries/retail.jpg',
    photoLabel: $localize`:@@featureForepathIndustry-retailPhotoLabel:Bright clothing store with garment rails and a large plant`,
    fitTitle: $localize`:@@featureForepathIndustry-retailFitTitle:One view across store and shop`,
    fitLead: $localize`:@@featureForepathIndustry-retailFitLead:We advise, build, and operate the systems that connect your stores, your online shop, and the warehouse behind them.`,
    fitItems: [
      {
        icon: 'bi-code-slash',
        text: $localize`:@@featureForepathIndustry-retailFit1:Online shops and integrations keep stock, prices, and orders consistent across all channels.`,
      },
      {
        icon: 'bi-cloud-check',
        text: $localize`:@@featureForepathIndustry-retailFit2:Cloudflare and capacity planning keep shops fast and protected during campaigns.`,
      },
      {
        icon: 'bi-shop',
        text: $localize`:@@featureForepathIndustry-retailFit3:Store networks keep checkout, payment terminals, and guest Wi-Fi apart and online.`,
      },
      {
        icon: 'bi-laptop',
        text: $localize`:@@featureForepathIndustry-retailFit4:Devices for stores and back office are set up on one baseline and supported quickly.`,
      },
    ],
    solutions: [
      {
        id: 'commerce-integrations',
        icon: 'bi-code-slash',
        title: $localize`:@@featureForepathIndustry-retailSolution1Title:Shop and marketplace integrations`,
        description: $localize`:@@featureForepathIndustry-retailSolution1Desc:Online shops, marketplace connectors, and interfaces to ERP and warehouse, built on maintainable stacks with automated tests.`,
        items: [
          $localize`:@@featureForepathIndustry-retailSolution1Item1:Stock and prices synchronized across all channels`,
          $localize`:@@featureForepathIndustry-retailSolution1Item2:Order flow from shop to warehouse and invoice`,
          $localize`:@@featureForepathIndustry-retailSolution1Item3:Load tests before campaigns and sales`,
        ],
        link: LINKS.development,
      },
      {
        id: 'shop-protection',
        icon: 'bi-cloud-check',
        title: $localize`:@@featureForepathIndustry-retailSolution2Title:Fast and protected shops`,
        description: $localize`:@@featureForepathIndustry-retailSolution2Desc:Cloudflare in front of your shop with DDoS protection and a web application firewall, plus monitoring of availability and certificates.`,
        items: [
          $localize`:@@featureForepathIndustry-retailSolution2Item1:DDoS protection and web application firewall`,
          $localize`:@@featureForepathIndustry-retailSolution2Item2:Availability and certificate monitoring`,
          $localize`:@@featureForepathIndustry-retailSolution2Item3:Regular reviews of what is exposed to the internet`,
        ],
        link: { ...LINKS.security, fragment: 'perimeter' },
      },
      {
        id: 'store-networks',
        icon: 'bi-shop',
        title: $localize`:@@featureForepathIndustry-retailSolution3Title:Store networks and checkout`,
        description: $localize`:@@featureForepathIndustry-retailSolution3Desc:Networks for every branch with separate zones for checkout, staff, and guests, connected to headquarters through a managed firewall.`,
        items: [
          $localize`:@@featureForepathIndustry-retailSolution3Item1:Separate networks for checkout, staff, and guest Wi-Fi`,
          $localize`:@@featureForepathIndustry-retailSolution3Item2:Site-to-site VPN from every store to headquarters`,
          $localize`:@@featureForepathIndustry-retailSolution3Item3:Changes rolled out to all branches in one window`,
        ],
        link: { ...LINKS.network, fragment: 'managed-firewall' },
      },
      {
        id: 'cloud-architecture',
        icon: 'bi-cloud',
        title: $localize`:@@featureForepathIndustry-retailSolution4Title:Cloud and platform architecture`,
        description: $localize`:@@featureForepathIndustry-retailSolution4Desc:Architecture for shops and services that scale with demand, with guardrails for cost and security from day one.`,
        items: [
          $localize`:@@featureForepathIndustry-retailSolution4Item1:Platform choice with effort ranges and tradeoffs`,
          $localize`:@@featureForepathIndustry-retailSolution4Item2:Cost models for normal days and peak season`,
          $localize`:@@featureForepathIndustry-retailSolution4Item3:Security review before launch`,
        ],
        link: LINKS.consulting,
      },
    ],
    oneThread: 'development',
    ctaTitle: $localize`:@@featureForepathIndustry-retailCtaTitle:Ready for your next peak season?`,
    ctaLead: $localize`:@@featureForepathIndustry-retailCtaLead:Tell us about your stores, your shop, and the systems behind them. We will propose where to start, from a store network to a new integration.`,
  },
  {
    id: 'healthcare',
    route: '/industries/healthcare',
    icon: 'bi-heart-pulse',
    title: $localize`:@@featureForepathIndustry-healthcareTitle:Healthcare and care`,
    navCaption: $localize`:@@featureForepathIndustry-healthcareNavCaption:Practices, clinics, and care providers`,
    metaTitle: $localize`:@@featureForepathIndustry-healthcareMetaTitle:IT for medical practices and care providers :: ForePath`,
    metaDescription: $localize`:@@featureForepathIndustry-healthcareMetaDescription:ForePath runs segmented networks, role-based access, ransomware-resistant backups, and security reviews for medical practices, clinics, and care providers.`,
    metaKeywords: $localize`:@@featureForepathIndustry-healthcareMetaKeywords:IT for medical practices, healthcare IT, care provider IT, patient data protection, backup, ransomware, managed IT`,
    heroAccent: $localize`:@@featureForepathIndustry-healthcareHeroAccent:Healthcare IT`,
    heroRest: $localize`:@@featureForepathIndustry-healthcareHeroRest:that is there when patients are`,
    heroLead: $localize`:@@featureForepathIndustry-healthcareHeroLead:Practices, medical care centres, and care providers trust us with workplaces, networks, and backups that protect patient data and keep appointments running.`,
    challengesTitle: $localize`:@@featureForepathIndustry-healthcareChallengesTitle:What healthcare IT has to handle`,
    challengesLead: $localize`:@@featureForepathIndustry-healthcareChallengesLead:Care cannot wait for a slow computer. At the same time, patient data is among the most sensitive data there is.`,
    challenges: [
      {
        icon: 'bi-file-medical',
        title: $localize`:@@featureForepathIndustry-healthcareChallenge1Title:Sensitive patient data`,
        description: $localize`:@@featureForepathIndustry-healthcareChallenge1Desc:Records, findings, and correspondence need strict access control and protection.`,
      },
      {
        icon: 'bi-calendar-x',
        title: $localize`:@@featureForepathIndustry-healthcareChallenge2Title:No time for outages`,
        description: $localize`:@@featureForepathIndustry-healthcareChallenge2Desc:A failed server or network in the morning means a waiting room full of patients.`,
      },
      {
        icon: 'bi-people',
        title: $localize`:@@featureForepathIndustry-healthcareChallenge3Title:Many people, many shifts`,
        description: $localize`:@@featureForepathIndustry-healthcareChallenge3Desc:Staff in shifts and part time need quick access and clean offboarding.`,
      },
      {
        icon: 'bi-shield-exclamation',
        title: $localize`:@@featureForepathIndustry-healthcareChallenge4Title:A target for attacks`,
        description: $localize`:@@featureForepathIndustry-healthcareChallenge4Desc:Ransomware hits practices and care providers that have no IT team of their own.`,
      },
    ],
    photoUrl: '/assets/images/industries/healthcare.jpg',
    photoLabel: $localize`:@@featureForepathIndustry-healthcarePhotoLabel:Two clinic staff members reviewing data at a workstation`,
    fitTitle: $localize`:@@featureForepathIndustry-healthcareFitTitle:IT that supports care, not the other way around`,
    fitLead: $localize`:@@featureForepathIndustry-healthcareFitLead:We operate the systems behind your practice or facility, so your staff can focus on patients, and we document every change.`,
    fitItems: [
      {
        icon: 'bi-hdd-network',
        text: $localize`:@@featureForepathIndustry-healthcareFit1:Separate networks for practice systems, medical devices, and guest Wi-Fi keep sensitive traffic apart.`,
      },
      {
        icon: 'bi-fingerprint',
        text: $localize`:@@featureForepathIndustry-healthcareFit2:Role-based access and multi-factor sign-in protect patient data across shifts and locations.`,
      },
      {
        icon: 'bi-cloud-arrow-up',
        text: $localize`:@@featureForepathIndustry-healthcareFit3:Encrypted backups with offsite copies and restore drills keep data recoverable after an attack.`,
      },
      {
        icon: 'bi-headset',
        text: $localize`:@@featureForepathIndustry-healthcareFit4:Remote support handles quick fixes, and we come on site when hands are needed.`,
      },
    ],
    solutions: [
      {
        id: 'practice-networks',
        icon: 'bi-hdd-network',
        title: $localize`:@@featureForepathIndustry-healthcareSolution1Title:Segmented practice networks`,
        description: $localize`:@@featureForepathIndustry-healthcareSolution1Desc:Firewalls and switching that keep practice software, medical devices, and guest Wi-Fi in separate zones.`,
        items: [
          $localize`:@@featureForepathIndustry-healthcareSolution1Item1:Separate zones for staff, devices, and patients`,
          $localize`:@@featureForepathIndustry-healthcareSolution1Item2:Managed firewall with documented rule changes`,
          $localize`:@@featureForepathIndustry-healthcareSolution1Item3:Wi-Fi for treatment rooms and waiting areas`,
        ],
        link: { ...LINKS.network, fragment: 'managed-firewall' },
      },
      {
        id: 'role-access',
        icon: 'bi-fingerprint',
        title: $localize`:@@featureForepathIndustry-healthcareSolution2Title:Access for shifts and roles`,
        description: $localize`:@@featureForepathIndustry-healthcareSolution2Desc:Accounts and permissions that follow roles, shifts, and locations, with door access tied to the same process.`,
        items: [
          $localize`:@@featureForepathIndustry-healthcareSolution2Item1:Role-based access to patient data`,
          $localize`:@@featureForepathIndustry-healthcareSolution2Item2:MFA for remote access and administration`,
          $localize`:@@featureForepathIndustry-healthcareSolution2Item3:Accounts and badges revoked on the last day`,
        ],
        link: { ...LINKS.identity, fragment: 'physical-access' },
      },
      {
        id: 'ransomware-recovery',
        icon: 'bi-cloud-arrow-up',
        title: $localize`:@@featureForepathIndustry-healthcareSolution3Title:Backup and recovery against ransomware`,
        description: $localize`:@@featureForepathIndustry-healthcareSolution3Desc:Encrypted, immutable backups with an offsite copy and restore drills, so an attack does not end in data loss.`,
        items: [
          $localize`:@@featureForepathIndustry-healthcareSolution3Item1:Offsite and immutable backup copies`,
          $localize`:@@featureForepathIndustry-healthcareSolution3Item2:Recovery targets agreed per system`,
          $localize`:@@featureForepathIndustry-healthcareSolution3Item3:Restore drills on a fixed schedule`,
        ],
        link: { ...LINKS.resilience, fragment: 'backup' },
      },
      {
        id: 'security-review',
        icon: 'bi-clipboard-check',
        title: $localize`:@@featureForepathIndustry-healthcareSolution4Title:Data protection and security review`,
        description: $localize`:@@featureForepathIndustry-healthcareSolution4Desc:An assessment of your systems against data protection and security requirements, with a prioritized list of measures.`,
        items: [
          $localize`:@@featureForepathIndustry-healthcareSolution4Item1:Inventory of systems and data flows`,
          $localize`:@@featureForepathIndustry-healthcareSolution4Item2:Gaps ranked by risk and effort`,
          $localize`:@@featureForepathIndustry-healthcareSolution4Item3:Evidence your auditors and insurers can follow`,
        ],
        link: LINKS.consulting,
      },
    ],
    oneThread: 'it-systems',
    ctaTitle: $localize`:@@featureForepathIndustry-healthcareCtaTitle:How well protected is your patient data?`,
    ctaLead: $localize`:@@featureForepathIndustry-healthcareCtaLead:Tell us about your practice or facility and its systems. We will start with a short assessment and propose the measures that matter first.`,
  },
  {
    id: 'professional-services',
    route: '/industries/professional-services',
    icon: 'bi-briefcase',
    title: $localize`:@@featureForepathIndustry-professionalTitle:Professional services`,
    navCaption: $localize`:@@featureForepathIndustry-professionalNavCaption:Law, tax, consulting, and agencies`,
    metaTitle: $localize`:@@featureForepathIndustry-professionalMetaTitle:IT for law firms, tax advisors, and agencies :: ForePath`,
    metaDescription: $localize`:@@featureForepathIndustry-professionalMetaDescription:ForePath runs secure Microsoft 365 workplaces, MFA and access reviews, MailStore email archiving, and Decabill billing for law firms, tax advisors, consultancies, and agencies.`,
    metaKeywords: $localize`:@@featureForepathIndustry-professionalMetaKeywords:IT for law firms, IT for tax advisors, agency IT, Microsoft 365, MailStore, GoBD, DATEV, Decabill`,
    heroAccent: $localize`:@@featureForepathIndustry-professionalHeroAccent:Professional services`,
    heroRest: $localize`:@@featureForepathIndustry-professionalHeroRest:with IT that keeps client data confidential`,
    heroLead: $localize`:@@featureForepathIndustry-professionalHeroLead:Law firms, tax advisors, consultancies, and agencies rely on us for secure workplaces, compliant archiving, and billing that matches how they work.`,
    challengesTitle: $localize`:@@featureForepathIndustry-professionalChallengesTitle:What firms need from their IT`,
    challengesLead: $localize`:@@featureForepathIndustry-professionalChallengesLead:Your people sell expertise and time. IT should protect client data and stay out of the way, without an IT department of your own.`,
    challenges: [
      {
        icon: 'bi-lock',
        title: $localize`:@@featureForepathIndustry-professionalChallenge1Title:Confidential client data`,
        description: $localize`:@@featureForepathIndustry-professionalChallenge1Desc:Mandates, files, and correspondence must be protected, and every access must be traceable.`,
      },
      {
        icon: 'bi-archive',
        title: $localize`:@@featureForepathIndustry-professionalChallenge2Title:Retention duties`,
        description: $localize`:@@featureForepathIndustry-professionalChallenge2Desc:Email and documents have to be archived completely and found again years later.`,
      },
      {
        icon: 'bi-person-workspace',
        title: $localize`:@@featureForepathIndustry-professionalChallenge3Title:Work from anywhere`,
        description: $localize`:@@featureForepathIndustry-professionalChallenge3Desc:Partners and staff work in the office, at clients, and from home on the same files.`,
      },
      {
        icon: 'bi-receipt',
        title: $localize`:@@featureForepathIndustry-professionalChallenge4Title:Hours that become invoices`,
        description: $localize`:@@featureForepathIndustry-professionalChallenge4Desc:Time tracking, projects, and invoices often live in separate tools.`,
      },
    ],
    photoUrl: '/assets/images/industries/professional-services.jpg',
    photoLabel: $localize`:@@featureForepathIndustry-professionalPhotoLabel:Partner and associate reviewing documents together at a desk`,
    fitTitle: $localize`:@@featureForepathIndustry-professionalFitTitle:IT that lets your experts focus`,
    fitLead: $localize`:@@featureForepathIndustry-professionalFitLead:We advise, build, and operate the workplace, security, and billing tools that a firm without its own IT department needs.`,
    fitItems: [
      {
        icon: 'bi-microsoft',
        text: $localize`:@@featureForepathIndustry-professionalFit1:Managed Microsoft 365 brings mail, files, and Teams under secure defaults and clear permissions.`,
      },
      {
        icon: 'bi-fingerprint',
        text: $localize`:@@featureForepathIndustry-professionalFit2:Multi-factor sign-in and access reviews protect client data wherever your team works.`,
      },
      {
        icon: 'bi-archive',
        text: $localize`:@@featureForepathIndustry-professionalFit3:MailStore archives every email tamper-proof to support retention duties such as GoBD.`,
      },
      {
        icon: 'bi-receipt',
        text: $localize`:@@featureForepathIndustry-professionalFit4:Decabill turns client services and projects into invoices, with DATEV export for your accountant.`,
      },
    ],
    solutions: [
      {
        id: 'secure-workplace',
        icon: 'bi-microsoft',
        title: $localize`:@@featureForepathIndustry-professionalSolution1Title:Secure workplace with Microsoft 365`,
        description: $localize`:@@featureForepathIndustry-professionalSolution1Desc:Microsoft 365 and business laptops set up with secure defaults, so your team can work in the office, at clients, and from home.`,
        items: [
          $localize`:@@featureForepathIndustry-professionalSolution1Item1:Tenant setup, migration, and secure sharing defaults`,
          $localize`:@@featureForepathIndustry-professionalSolution1Item2:Laptops on one baseline with approved software`,
          $localize`:@@featureForepathIndustry-professionalSolution1Item3:Fast remote support for everyday questions`,
        ],
        link: { ...LINKS.workplace, fragment: 'microsoft-365' },
      },
      {
        id: 'client-data-access',
        icon: 'bi-fingerprint',
        title: $localize`:@@featureForepathIndustry-professionalSolution2Title:Access control and MFA`,
        description: $localize`:@@featureForepathIndustry-professionalSolution2Desc:Multi-factor authentication, role-based permissions, and access reviews that show who can open which client file.`,
        items: [
          $localize`:@@featureForepathIndustry-professionalSolution2Item1:MFA for mail, files, and remote access`,
          $localize`:@@featureForepathIndustry-professionalSolution2Item2:Permissions by role, team, and mandate`,
          $localize`:@@featureForepathIndustry-professionalSolution2Item3:Accounts closed on the day someone leaves`,
        ],
        link: { ...LINKS.identity, fragment: 'entra-active-directory' },
      },
      {
        id: 'archiving',
        icon: 'bi-archive',
        title: $localize`:@@featureForepathIndustry-professionalSolution3Title:Email archiving and backup`,
        description: $localize`:@@featureForepathIndustry-professionalSolution3Desc:MailStore archiving and tested backups keep correspondence and files available for as long as retention rules require.`,
        items: [
          $localize`:@@featureForepathIndustry-professionalSolution3Item1:Complete, tamper-proof email archive`,
          $localize`:@@featureForepathIndustry-professionalSolution3Item2:Full-text search for staff and auditors`,
          $localize`:@@featureForepathIndustry-professionalSolution3Item3:Backups with scheduled restore drills`,
        ],
        link: { ...LINKS.resilience, fragment: 'mailstore' },
      },
      {
        id: 'billing',
        icon: 'bi-receipt',
        title: $localize`:@@featureForepathIndustry-professionalSolution4Title:Billing with Decabill`,
        description: $localize`:@@featureForepathIndustry-professionalSolution4Desc:Decabill bills client services, projects, and subscriptions on one platform and exports to DATEV for your accountant.`,
        items: [
          $localize`:@@featureForepathIndustry-professionalSolution4Item1:Client services and projects billed from one platform`,
          $localize`:@@featureForepathIndustry-professionalSolution4Item2:DATEV export for your accountant`,
          $localize`:@@featureForepathIndustry-professionalSolution4Item3:Built and run by the team that runs your IT`,
        ],
        link: LINKS.decabill,
      },
    ],
    oneThread: 'it-systems',
    ctaTitle: $localize`:@@featureForepathIndustry-professionalCtaTitle:Does your IT match your professional standards?`,
    ctaLead: $localize`:@@featureForepathIndustry-professionalCtaLead:Tell us how your firm works today. We will start with a short review and propose the steps that protect client data first.`,
  },
  {
    id: 'software',
    route: '/industries/software',
    icon: 'bi-code-square',
    title: $localize`:@@featureForepathIndustry-softwareTitle:Software and SaaS`,
    navCaption: $localize`:@@featureForepathIndustry-softwareNavCaption:Product teams, startups, and SaaS vendors`,
    metaTitle: $localize`:@@featureForepathIndustry-softwareMetaTitle:Engineering for software companies and SaaS vendors :: ForePath`,
    metaDescription: $localize`:@@featureForepathIndustry-softwareMetaDescription:ForePath extends product teams with cloud and platform engineering, delivery pipelines, Agenstra coding agents, and Decabill SaaS billing.`,
    metaKeywords: $localize`:@@featureForepathIndustry-softwareMetaKeywords:SaaS engineering, platform engineering, Kubernetes, CI/CD, coding agents, Agenstra, Decabill, Loadweaver, startup`,
    heroAccent: $localize`:@@featureForepathIndustry-softwareHeroAccent:Software companies`,
    heroRest: $localize`:@@featureForepathIndustry-softwareHeroRest:that ship faster without losing control`,
    heroLead: $localize`:@@featureForepathIndustry-softwareHeroLead:We extend product teams with platform engineering, delivery pipelines, and coding agents, and we bill SaaS with the platform we run ourselves.`,
    challengesTitle: $localize`:@@featureForepathIndustry-softwareChallengesTitle:What holds product teams back`,
    challengesLead: $localize`:@@featureForepathIndustry-softwareChallengesLead:Roadmaps grow faster than teams. Platforms, pipelines, and billing compete with features for the same engineers.`,
    challenges: [
      {
        icon: 'bi-stack',
        title: $localize`:@@featureForepathIndustry-softwareChallenge1Title:Platform work crowds out features`,
        description: $localize`:@@featureForepathIndustry-softwareChallenge1Desc:Clusters, environments, and upgrades eat into time meant for the product.`,
      },
      {
        icon: 'bi-git',
        title: $localize`:@@featureForepathIndustry-softwareChallenge2Title:Releases that feel risky`,
        description: $localize`:@@featureForepathIndustry-softwareChallenge2Desc:Manual steps and missing tests turn every deployment into an event.`,
      },
      {
        icon: 'bi-robot',
        title: $localize`:@@featureForepathIndustry-softwareChallenge3Title:AI without a plan`,
        description: $localize`:@@featureForepathIndustry-softwareChallenge3Desc:Coding agents promise speed, but need guardrails, review, and a place to run.`,
      },
      {
        icon: 'bi-receipt',
        title: $localize`:@@featureForepathIndustry-softwareChallenge4Title:Billing that does not scale`,
        description: $localize`:@@featureForepathIndustry-softwareChallenge4Desc:Subscriptions, usage, and services end up in spreadsheets as customers grow.`,
      },
    ],
    photoUrl: '/assets/images/industries/software.jpg',
    photoLabel: $localize`:@@featureForepathIndustry-softwarePhotoLabel:Developers working at their monitors in a software office`,
    fitTitle: $localize`:@@featureForepathIndustry-softwareFitTitle:An extension of your engineering team`,
    fitLead: $localize`:@@featureForepathIndustry-softwareFitLead:We advise, build, and operate alongside your engineers, on stacks they can own after we step back.`,
    fitItems: [
      {
        icon: 'bi-cloud',
        text: $localize`:@@featureForepathIndustry-softwareFit1:Cloud and Kubernetes platforms with networking, identity, and upgrades your operators can sustain.`,
      },
      {
        icon: 'bi-git',
        text: $localize`:@@featureForepathIndustry-softwareFit2:CI/CD pipelines, GitOps, and infrastructure as code make releases routine.`,
      },
      {
        icon: 'bi-robot',
        text: $localize`:@@featureForepathIndustry-softwareFit3:Agenstra runs coding agents with workspaces, tickets, and knowledge on infrastructure you own.`,
      },
      {
        icon: 'bi-receipt',
        text: $localize`:@@featureForepathIndustry-softwareFit4:Decabill bills SaaS subscriptions and services together, with DATEV export.`,
      },
    ],
    solutions: [
      {
        id: 'platform-engineering',
        icon: 'bi-cloud',
        title: $localize`:@@featureForepathIndustry-softwareSolution1Title:Cloud and platform engineering`,
        description: $localize`:@@featureForepathIndustry-softwareSolution1Desc:Account strategy, Kubernetes estates, and FinOps discipline, designed with your team and built to be operated by it.`,
        items: [
          $localize`:@@featureForepathIndustry-softwareSolution1Item1:Reference architectures for cloud and Kubernetes`,
          $localize`:@@featureForepathIndustry-softwareSolution1Item2:Cost models that scale with usage`,
          $localize`:@@featureForepathIndustry-softwareSolution1Item3:Runbooks and on-call patterns for your engineers`,
        ],
        link: LINKS.consulting,
      },
      {
        id: 'delivery',
        icon: 'bi-git',
        title: $localize`:@@featureForepathIndustry-softwareSolution2Title:Delivery pipelines and product engineering`,
        description: $localize`:@@featureForepathIndustry-softwareSolution2Desc:Pipelines, tests, and environments that make releases routine, plus engineers who ship features together with your team.`,
        items: [
          $localize`:@@featureForepathIndustry-softwareSolution2Item1:CI/CD foundations and GitOps`,
          $localize`:@@featureForepathIndustry-softwareSolution2Item2:Pairing and knowledge transfer built in`,
          $localize`:@@featureForepathIndustry-softwareSolution2Item3:Delivery metrics tracked against DORA baselines`,
        ],
        link: LINKS.development,
      },
      {
        id: 'coding-agents',
        icon: 'bi-robot',
        title: $localize`:@@featureForepathIndustry-softwareSolution3Title:Coding agents with Agenstra`,
        description: $localize`:@@featureForepathIndustry-softwareSolution3Desc:Agenstra lets your team run and ship with coding agents, on infrastructure you own or in Agenstra Cloud.`,
        items: [
          $localize`:@@featureForepathIndustry-softwareSolution3Item1:Workspaces, tickets, and knowledge in one place`,
          $localize`:@@featureForepathIndustry-softwareSolution3Item2:On infrastructure you own or in Agenstra Cloud`,
          $localize`:@@featureForepathIndustry-softwareSolution3Item3:Desktop app for your whole team`,
        ],
        link: LINKS.agenstra,
      },
      {
        id: 'saas-billing',
        icon: 'bi-receipt',
        title: $localize`:@@featureForepathIndustry-softwareSolution4Title:SaaS billing with Decabill`,
        description: $localize`:@@featureForepathIndustry-softwareSolution4Desc:Decabill bills SaaS subscriptions, client services, and managed hosting with one platform.`,
        items: [
          $localize`:@@featureForepathIndustry-softwareSolution4Item1:Client services, projects, and SaaS subscriptions`,
          $localize`:@@featureForepathIndustry-softwareSolution4Item2:Managed hosting billed on the same invoice run`,
          $localize`:@@featureForepathIndustry-softwareSolution4Item3:DATEV export for your accountant`,
        ],
        link: LINKS.decabill,
      },
      {
        id: 'own-servers',
        icon: 'bi-hdd-network',
        title: $localize`:@@featureForepathIndustry-softwareSolution5Title:Your own servers as one platform with Loadweaver`,
        description: $localize`:@@featureForepathIndustry-softwareSolution5Desc:Loadweaver turns a handful of servers into a resilient cluster for your Compose apps, with policies, failover, and isolation up to microVMs. Now in early access.`,
        items: [
          $localize`:@@featureForepathIndustry-softwareSolution5Item1:Docker Compose deployments through plan and apply`,
          $localize`:@@featureForepathIndustry-softwareSolution5Item2:Replicated storage and ingress that fails over on its own`,
          $localize`:@@featureForepathIndustry-softwareSolution5Item3:gVisor sandboxes and microVMs for untrusted workloads`,
        ],
        link: LINKS.loadweaver,
      },
    ],
    oneThread: 'development',
    ctaTitle: $localize`:@@featureForepathIndustry-softwareCtaTitle:What would your team ship with more time?`,
    ctaLead: $localize`:@@featureForepathIndustry-softwareCtaLead:Tell us about your product, stack, and roadmap. We will propose a team shape and the platform work that frees your engineers first.`,
  },
];

export function forepathIndustryById(id: ForepathIndustryId): ForepathIndustry {
  const industry = FOREPATH_INDUSTRIES.find((candidate) => candidate.id === id);

  if (!industry) {
    throw new Error(`Unknown ForePath industry: ${id}`);
  }

  return industry;
}
