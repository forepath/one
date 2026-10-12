import { createHash } from 'crypto';

import {
  compactEgressHostEntries,
  EGRESS_PRIVATE_NETWORK_CIDRS,
  normalizeEffectiveEgressPolicy,
  normalizeEgressHost,
  parseEgressPortSpec,
  stablePlatformPolicyJson,
  type EffectiveEgressNetworkRule,
  type EffectiveEgressPolicy,
} from '@forepath/agenstra/shared/util-opencode-config';

import {
  EGRESS_GUARD_ACTIVE_DIR,
  EGRESS_GUARD_COUNTER_COMMENT_PREFIX,
  EGRESS_GUARD_DNS_PORT,
  EGRESS_GUARD_DNS_UID,
  EGRESS_GUARD_EXPLICIT_PROXY_PORT,
  EGRESS_GUARD_HTTP_INTERCEPT_PORT,
  EGRESS_GUARD_HTTPS_INTERCEPT_PORT,
  EGRESS_GUARD_PROXY_MARK,
  EGRESS_GUARD_RESOLVERS_CHAIN,
  EGRESS_GUARD_STATE_DIR,
  EGRESS_GUARD_WEB_LOG_MARKER,
} from '../constants/egress-guard.constants';

/** Parent proxy the guard chains to (from the layered `HTTPS_PROXY` / `HTTP_PROXY` network secrets). */
export interface EgressUpstreamProxy {
  host: string;
  port: number;
  username?: string;
  password?: string;
  /** Hosts that bypass the parent proxy (from `NO_PROXY`). */
  bypassHosts: string[];
}

export interface EgressGuardArtifacts {
  revision: string;
  /** File name → content, written into the guard's staged policy directory. */
  files: Record<string, string>;
}

/** Bump when the rendered artifact format changes so running guards are re-applied after upgrades. */
export const EGRESS_GUARD_RENDER_VERSION = 1;

const SQUID_LOG_FORMAT = [
  EGRESS_GUARD_WEB_LOG_MARKER,
  '%ts.%03tu',
  '%Ss',
  '%>Hs',
  '%rm',
  '%#ru',
  '%#>rd',
  '%#ssl::>sni',
  '%<a',
  '%<st',
  '%>st',
  '%tr',
  '%#{agenstra_rule}note',
  '%err_code',
].join(' ');

function activeFile(name: string): string {
  return `"${EGRESS_GUARD_ACTIVE_DIR}/${name}"`;
}

function splitHosts(entries: readonly { value: string }[]): { domains: string[]; ips: string[] } {
  const domains: string[] = [];
  const ips: string[] = [];

  for (const entry of compactEgressHostEntries(entries)) {
    const normalized = normalizeEgressHost(entry.value);

    if (!normalized) {
      continue;
    }

    if (normalized.kind === 'domain') {
      domains.push(normalized.value);
    } else {
      ips.push(normalized.value);
    }
  }

  return { domains, ips };
}

function lines(values: readonly string[]): string {
  return values.length ? `${values.join('\n')}\n` : '';
}

/**
 * Parse a proxy URL (`http://user:pass@host:port`) into a parent proxy definition.
 * Credentials containing characters Squid cannot represent in `login=` are dropped.
 */
export function parseEgressUpstreamProxy(
  proxyUrl: string | undefined | null,
  noProxy: string | undefined | null,
): EgressUpstreamProxy | null {
  const raw = proxyUrl?.trim();

  if (!raw) {
    return null;
  }

  let parsed: URL;

  try {
    parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:') {
    // Squid speaks plain HTTP (CONNECT) to a parent; TLS-to-proxy is not supported here.
    return null;
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, '');

  if (!host || /[\s"]/.test(host)) {
    return null;
  }

  const port = parsed.port ? Number(parsed.port) : 80;
  const safeCredential = (value: string) => value && /^[^\s"'\\]+$/.test(value);
  const decode = (value: string): string | undefined => {
    try {
      return decodeURIComponent(value);
    } catch {
      return undefined;
    }
  };
  const username = parsed.username ? decode(parsed.username) : undefined;
  const password = parsed.password ? decode(parsed.password) : undefined;
  const bypassHosts = (noProxy ?? '')
    .split(',')
    .map((entry) => normalizeEgressHost(entry.trim()))
    .filter((entry): entry is NonNullable<typeof entry> => !!entry && entry.kind === 'domain')
    .map((entry) => entry.value)
    .filter((value) => value !== 'localhost');

  return {
    host,
    port,
    ...(username && safeCredential(username) ? { username } : {}),
    ...(username && password && safeCredential(username) && safeCredential(password) ? { password } : {}),
    bypassHosts: [...new Set(bypassHosts)],
  };
}

/** Deterministic revision for a policy + upstream proxy (+ render format version). */
export function computeEgressPolicyRevision(
  input: EffectiveEgressPolicy,
  upstream: EgressUpstreamProxy | null = null,
): string {
  const policy = normalizeEffectiveEgressPolicy(input);

  return createHash('sha256')
    .update(
      stablePlatformPolicyJson({
        version: EGRESS_GUARD_RENDER_VERSION,
        policy: { ...policy, scalarSources: undefined },
        upstream,
      }),
    )
    .digest('hex')
    .slice(0, 32);
}

/**
 * `http_access deny` lines for one rule: non-CONNECT requests are reset (`agenstra_drop`), CONNECT
 * requests receive a bare 403 (clients report a failed tunnel).
 */
function denyLines(acls: string): string[] {
  if (acls.startsWith('CONNECT ')) {
    return [`http_access deny ${acls}`];
  }

  if (acls.startsWith('!CONNECT ')) {
    return [`http_access deny ${acls} agenstra_drop`];
  }

  return [`http_access deny !CONNECT ${acls} agenstra_drop`, `http_access deny CONNECT ${acls}`];
}

function renderSquidConfig(
  policy: EffectiveEgressPolicy,
  upstream: EgressUpstreamProxy | null,
  hosts: { allow: { domains: string[]; ips: string[] }; deny: { domains: string[]; ips: string[] } },
  revision: string,
): string {
  const out: string[] = [
    `# Generated by the Agenstra agent manager — revision ${revision}, mode ${policy.mode}. Do not edit.`,
    `http_port 127.0.0.1:${EGRESS_GUARD_EXPLICIT_PROXY_PORT} name=explicit`,
    `http_port 127.0.0.1:${EGRESS_GUARD_HTTP_INTERCEPT_PORT} intercept name=http_intercept`,
    `https_port 127.0.0.1:${EGRESS_GUARD_HTTPS_INTERCEPT_PORT} intercept ssl-bump name=https_intercept tls-cert=${EGRESS_GUARD_STATE_DIR}/bootstrap.pem generate-host-certificates=off`,
    'pid_filename /run/agenstra-egress/squid.pid',
    'cache_effective_user egressproxy',
    'cache_effective_group egressproxy',
    // Upstream sockets carry a mark (needs CAP_NET_ADMIN) — netfilter trusts the mark, not the UID.
    `tcp_outgoing_mark ${EGRESS_GUARD_PROXY_MARK} all`,
    // Resolve through the guard's DNS policy proxy (port 53 is redirected to dnsmasq).
    'dns_nameservers 127.0.0.1',
    'cache deny all',
    'cache_mem 8 MB',
    'cache_log /var/log/agenstra-egress/cache.log',
    'logfile_rotate 1',
    'coredump_dir /tmp',
    'strip_query_terms on',
    'host_verify_strict on',
    'forwarded_for delete',
    'via off',
    'httpd_suppress_version_string on',
    'shutdown_lifetime 1 seconds',
    '',
    'acl step1 at_step SslBump1',
    'acl CONNECT method CONNECT',
    'acl tls_ports port 443',
    'acl intercepted_tls myportname https_intercept',
    'acl has_rule note agenstra_rule',
    // Blocked plain HTTP is dropped with a TCP reset instead of a Squid error page (deny_info applies
    // to the last ACL of the matching http_access line). Blocked CONNECT keeps the bare 403, which
    // clients report as a failed tunnel; intercepted TLS is terminated during the handshake.
    'acl agenstra_drop src all',
    'deny_info TCP_RESET agenstra_drop',
  ];

  const allowDomains = hosts.allow.domains.length > 0;
  const allowIps = hosts.allow.ips.length > 0;
  const denyDomains = hosts.deny.domains.length > 0;
  const denyIps = hosts.deny.ips.length > 0;
  const urlPatterns = policy.denyUrlPatterns.length > 0;
  const hasAllowlist = allowDomains || allowIps;

  if (allowDomains) {
    out.push(`acl allow_domains dstdomain -n ${activeFile('allow-domains.txt')}`);
    out.push(`acl allow_sni ssl::server_name ${activeFile('allow-domains.txt')}`);
  }

  if (allowIps) {
    out.push(`acl allow_dst dst ${activeFile('allow-ips.txt')}`);
  }

  if (denyDomains) {
    out.push(`acl deny_domains dstdomain -n ${activeFile('deny-domains.txt')}`);
    out.push(`acl deny_sni ssl::server_name ${activeFile('deny-domains.txt')}`);
  }

  if (denyIps) {
    out.push(`acl deny_dst dst ${activeFile('deny-ips.txt')}`);
  }

  if (policy.blockPrivateNetworks) {
    out.push(`acl private_dst dst ${activeFile('private-ips.txt')}`);
  }

  if (policy.blockIpLiterals) {
    out.push('acl ip_literal_host dstdom_regex -n -i ^[0-9.]+$ ^\\[?[0-9a-f]*:[0-9a-f:.]*\\]?$');
    out.push('acl ip_literal_sni ssl::server_name_regex -i ^[0-9.]+$ ^\\[?[0-9a-f]*:[0-9a-f:.]*\\]?$');
  }

  if (urlPatterns) {
    out.push(`acl deny_url url_regex -i ${activeFile('deny-url-patterns.txt')}`);
  }

  const notAllowedHttp = [allowDomains ? '!allow_domains' : null, allowIps ? '!allow_dst' : null]
    .filter(Boolean)
    .join(' ');
  const notAllowedTls = [allowDomains ? '!allow_sni' : null, allowIps ? '!allow_dst' : null].filter(Boolean).join(' ');
  const withAllowExemption = (condition: string, exemption: string) =>
    exemption ? `${condition} ${exemption}` : condition;

  // Annotations explain decisions in the access log (also in monitor mode, where nothing is denied).
  out.push('');

  const notes: string[] = [];

  if (policy.mode === 'offline') {
    notes.push('note agenstra_rule offline all');
  } else {
    if (denyDomains) {
      notes.push('note agenstra_rule deny_host !CONNECT deny_domains');
      notes.push('note agenstra_rule deny_host CONNECT deny_sni');
    }

    if (denyIps) {
      notes.push('note agenstra_rule deny_host deny_dst');
    }

    if (policy.blockPrivateNetworks) {
      notes.push(`note agenstra_rule private_network ${withAllowExemption('!CONNECT private_dst', notAllowedHttp)}`);
      notes.push(`note agenstra_rule private_network ${withAllowExemption('CONNECT private_dst', notAllowedTls)}`);
    }

    if (policy.blockIpLiterals) {
      notes.push(
        `note agenstra_rule ip_literal ${withAllowExemption('!CONNECT ip_literal_host', allowIps ? '!allow_dst' : '')}`,
      );
      notes.push(
        `note agenstra_rule ip_literal ${withAllowExemption('CONNECT ip_literal_sni', allowIps ? '!allow_dst' : '')}`,
      );
    }

    if (urlPatterns) {
      notes.push('note agenstra_rule deny_url !CONNECT deny_url');
    }

    if (hasAllowlist) {
      notes.push(`note agenstra_rule not_allowlisted !CONNECT ${notAllowedHttp}`);
      notes.push(`note agenstra_rule not_allowlisted CONNECT ${notAllowedTls}`);
    }

    notes.push('note agenstra_rule undeclared_protocol CONNECT !tls_ports !intercepted_tls');
  }

  out.push(...notes, '');

  // Intercepted TLS is decided after peeking the ClientHello (ssl_bump below); the first fake CONNECT
  // only carries the destination IP, so it must not be judged by host name here.
  out.push('http_access allow intercepted_tls');

  if (policy.mode === 'offline') {
    out.push(...denyLines('all'));
  } else if (policy.mode === 'enforce') {
    if (denyDomains) {
      out.push(...denyLines('!CONNECT deny_domains'));
      out.push(...denyLines('CONNECT deny_sni'));
    }

    if (denyIps) {
      out.push(...denyLines('deny_dst'));
    }

    if (policy.blockPrivateNetworks) {
      out.push(...denyLines(withAllowExemption('!CONNECT private_dst', notAllowedHttp)));
      out.push(...denyLines(withAllowExemption('CONNECT private_dst', notAllowedTls)));
    }

    if (policy.blockIpLiterals) {
      out.push(...denyLines(withAllowExemption('!CONNECT ip_literal_host', allowIps ? '!allow_dst' : '')));
      out.push(...denyLines(withAllowExemption('CONNECT ip_literal_sni', allowIps ? '!allow_dst' : '')));
    }

    if (urlPatterns) {
      out.push(...denyLines('!CONNECT deny_url'));
    }

    if (hasAllowlist) {
      out.push(...denyLines(`!CONNECT ${notAllowedHttp}`));
      out.push(...denyLines(`CONNECT ${notAllowedTls}`));
    }

    out.push(...denyLines('CONNECT !tls_ports'));
    out.push('http_access allow all');
  } else {
    out.push('http_access allow all');
  }

  out.push('', 'ssl_bump peek step1');

  if (policy.mode === 'offline') {
    out.push('ssl_bump terminate all');
  } else if (policy.mode === 'enforce') {
    if (denyDomains) {
      out.push('ssl_bump terminate deny_sni');
    }

    if (denyIps) {
      out.push('ssl_bump terminate deny_dst');
    }

    if (policy.blockPrivateNetworks) {
      out.push(`ssl_bump terminate ${withAllowExemption('private_dst', notAllowedTls)}`);
    }

    if (policy.blockIpLiterals) {
      out.push(`ssl_bump terminate ${withAllowExemption('ip_literal_sni', allowIps ? '!allow_dst' : '')}`);
    }

    if (hasAllowlist) {
      out.push(`ssl_bump terminate ${notAllowedTls}`);
    }
  }

  out.push('ssl_bump splice all', '');

  if (upstream) {
    const login =
      upstream.username !== undefined
        ? ` login=${upstream.username}${upstream.password !== undefined ? `:${upstream.password}` : ''}`
        : '';

    out.push(
      `cache_peer ${upstream.host} parent ${upstream.port} 0 no-query no-digest default name=agenstra_upstream${login}`,
    );

    if (upstream.bypassHosts.length > 0) {
      out.push(`acl upstream_bypass dstdomain -n ${upstream.bypassHosts.map((host) => `.${host}`).join(' ')}`);
      out.push('always_direct allow upstream_bypass');
    }

    out.push('never_direct allow all', '');
  }

  out.push(`logformat agenstra ${SQUID_LOG_FORMAT}`);
  out.push(`access_log stdio:/var/log/agenstra-egress/access.log agenstra${policy.logAllowed ? '' : ' has_rule'}`);

  return `${out.join('\n')}\n`;
}

function renderDnsmasqConfig(
  policy: EffectiveEgressPolicy,
  hosts: { allow: { domains: string[] }; deny: { domains: string[] } },
): string {
  const out = [
    '# Generated by the Agenstra agent manager. Do not edit.',
    `port=${EGRESS_GUARD_DNS_PORT}`,
    'listen-address=127.0.0.1',
    'bind-interfaces',
    'user=egressdns',
    'group=egressdns',
    'pid-file=/run/agenstra-egress/dnsmasq.pid',
    'cache-size=1000',
    'log-queries',
    'log-facility=-',
  ];

  if (policy.mode === 'off') {
    return `${out.join('\n')}\n`;
  }

  if (policy.blockPrivateNetworks && policy.mode !== 'monitor') {
    out.push('stop-dns-rebind');

    for (const domain of hosts.allow.domains) {
      out.push(`rebind-domain-ok=/${domain}/`);
    }
  }

  if (policy.mode === 'offline') {
    out.push('address=/#/');
  } else if (policy.mode === 'enforce') {
    for (const domain of hosts.deny.domains) {
      out.push(`address=/${domain}/`);
    }

    if (hosts.allow.domains.length > 0) {
      // Only allowlisted names resolve; IP / CIDR allow entries need no DNS.
      out.push('address=/#/');

      for (const domain of hosts.allow.domains) {
        out.push(`server=/${domain}/#`);
      }
    }
  }

  return `${out.join('\n')}\n`;
}

function portMatch(protocol: 'tcp' | 'udp', ports: string): string | null {
  const range = parseEgressPortSpec(ports);

  if (!range) {
    return null;
  }

  return `-p ${protocol} --dport ${range.from === range.to ? range.from : `${range.from}:${range.to}`}`;
}

function counted(category: string): string {
  return `-m comment --comment "${EGRESS_GUARD_COUNTER_COMMENT_PREFIX}${category}"`;
}

function networkRuleDestinations(rule: EffectiveEgressNetworkRule, family: 4 | 6): string[] {
  return rule.destinations.filter((destination) => {
    const normalized = normalizeEgressHost(destination);

    return family === 4 ? normalized?.kind === 'ipv4' : normalized?.kind === 'ipv6';
  });
}

function renderFilterOutChain(policy: EffectiveEgressPolicy, family: 4 | 6): string[] {
  const chain = 'AGENSTRA_EGRESS_OUT';
  const rules = [`-A ${chain} -o lo -j ACCEPT`, `-A ${chain} -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT`];

  if (policy.mode === 'off') {
    rules.push(`-A ${chain} -j ACCEPT`);

    return rules;
  }

  if (family === 4) {
    rules.push(`-A ${chain} -m conntrack --ctstate DNAT -d 127.0.0.1/32 -j ACCEPT`);
  }

  rules.push(`-A ${chain} -m mark --mark ${EGRESS_GUARD_PROXY_MARK} -j ACCEPT`);

  if (family === 4) {
    // dnsmasq may only reach the resolvers listed by the guard at boot (see `agenstra-egress lockdown`).
    rules.push(`-A ${chain} -m owner --uid-owner ${EGRESS_GUARD_DNS_UID} -j ${EGRESS_GUARD_RESOLVERS_CHAIN}`);
  }

  // Offline means offline: declared network exceptions are ignored.
  for (const rule of policy.mode === 'offline' ? [] : policy.networkAllow) {
    const match = portMatch(rule.protocol, rule.ports);

    if (!match) {
      continue;
    }

    for (const destination of networkRuleDestinations(rule, family)) {
      rules.push(`-A ${chain} -d ${destination} ${match} ${counted('network_allow')} -j ACCEPT`);
    }
  }

  const reject = 'REJECT';
  const categories: Array<{ match: string; category: string; target: string }> = [
    { match: '-p udp --dport 443', category: 'quic', target: reject },
    { match: '-p tcp --dport 853', category: 'dns_over_tls', target: `${reject} --reject-with tcp-reset` },
    { match: '-p udp --dport 853', category: 'dns_over_tls', target: reject },
  ];

  if (family === 6) {
    // IPv6 web traffic is not intercepted: reject so clients fall back to IPv4 through the guard.
    categories.push({ match: '-p tcp -m multiport --dports 80,443', category: 'undeclared_protocol', target: reject });
  }

  if (policy.mode === 'monitor') {
    // Count would-be blocks, then let traffic through.
    for (const category of categories) {
      rules.push(`-A ${chain} ${category.match} ${counted(category.category)}`);
    }

    rules.push(`-A ${chain} ${counted('undeclared_protocol')}`);
    rules.push(`-A ${chain} -j ACCEPT`);

    return rules;
  }

  for (const category of categories) {
    rules.push(`-A ${chain} ${category.match} ${counted(category.category)} -j ${category.target}`);
  }

  rules.push(`-A ${chain} ${counted('undeclared_protocol')} -j ${reject}`);

  return rules;
}

function renderIptablesV4(policy: EffectiveEgressPolicy): string {
  const nat = ['*nat', ':AGENSTRA_EGRESS_NAT - [0:0]'];

  if (policy.mode !== 'off') {
    nat.push(
      `-A AGENSTRA_EGRESS_NAT -m mark --mark ${EGRESS_GUARD_PROXY_MARK} -j RETURN`,
      `-A AGENSTRA_EGRESS_NAT -m owner --uid-owner ${EGRESS_GUARD_DNS_UID} -p udp --dport 53 -j RETURN`,
      `-A AGENSTRA_EGRESS_NAT -m owner --uid-owner ${EGRESS_GUARD_DNS_UID} -p tcp --dport 53 -j RETURN`,
      `-A AGENSTRA_EGRESS_NAT -p udp --dport 53 -j REDIRECT --to-ports ${EGRESS_GUARD_DNS_PORT}`,
      `-A AGENSTRA_EGRESS_NAT -p tcp --dport 53 -j REDIRECT --to-ports ${EGRESS_GUARD_DNS_PORT}`,
      '-A AGENSTRA_EGRESS_NAT -d 127.0.0.0/8 -j RETURN',
    );

    // Declared L3/L4 exceptions bypass the proxy entirely (e.g. TCP/443 to an internal service).
    for (const rule of policy.mode === 'offline' ? [] : policy.networkAllow) {
      const match = portMatch(rule.protocol, rule.ports);

      if (!match || rule.protocol !== 'tcp') {
        continue;
      }

      for (const destination of networkRuleDestinations(rule, 4)) {
        nat.push(`-A AGENSTRA_EGRESS_NAT -d ${destination} ${match} -j RETURN`);
      }
    }

    nat.push(
      `-A AGENSTRA_EGRESS_NAT -p tcp --dport 80 -j REDIRECT --to-ports ${EGRESS_GUARD_HTTP_INTERCEPT_PORT}`,
      `-A AGENSTRA_EGRESS_NAT -p tcp --dport 443 -j REDIRECT --to-ports ${EGRESS_GUARD_HTTPS_INTERCEPT_PORT}`,
    );
  }

  nat.push('COMMIT');

  const filter = [
    '*filter',
    ':AGENSTRA_EGRESS_IN - [0:0]',
    ':AGENSTRA_EGRESS_OUT - [0:0]',
    '-A AGENSTRA_EGRESS_IN -i lo -j RETURN',
    // Guard listeners are loopback-only; never expose them to peers on the Docker network.
    `-A AGENSTRA_EGRESS_IN -p tcp -m multiport --dports ${EGRESS_GUARD_EXPLICIT_PROXY_PORT}:${EGRESS_GUARD_HTTPS_INTERCEPT_PORT},${EGRESS_GUARD_DNS_PORT} -j DROP`,
    `-A AGENSTRA_EGRESS_IN -p udp --dport ${EGRESS_GUARD_DNS_PORT} -j DROP`,
    ...renderFilterOutChain(policy, 4),
    'COMMIT',
  ];

  return `${[...nat, ...filter].join('\n')}\n`;
}

function renderIptablesV6(policy: EffectiveEgressPolicy): string {
  return `${['*filter', ':AGENSTRA_EGRESS_OUT - [0:0]', ...renderFilterOutChain(policy, 6), 'COMMIT'].join('\n')}\n`;
}

/**
 * Render the complete guard policy bundle for an effective egress policy.
 * The guard validates every file before atomically activating the bundle (last known good is kept).
 */
export function renderEgressGuardArtifacts(
  input: EffectiveEgressPolicy,
  upstream: EgressUpstreamProxy | null = null,
): EgressGuardArtifacts {
  // Never trust the caller: every value ends up in Squid / dnsmasq / netfilter configuration files.
  const policy = normalizeEffectiveEgressPolicy(input);
  const revision = computeEgressPolicyRevision(policy, upstream);
  const allow = splitHosts(policy.allowHosts);
  const deny = splitHosts(policy.denyHosts);
  const hosts = { allow, deny };

  return {
    revision,
    files: {
      'squid.conf': renderSquidConfig(policy, upstream, hosts, revision),
      'allow-domains.txt': lines(allow.domains.map((domain) => `.${domain}`)),
      'allow-ips.txt': lines(allow.ips),
      'deny-domains.txt': lines(deny.domains.map((domain) => `.${domain}`)),
      'deny-ips.txt': lines(deny.ips),
      'deny-url-patterns.txt': lines(policy.denyUrlPatterns.map((pattern) => pattern.value)),
      'private-ips.txt': lines([...EGRESS_PRIVATE_NETWORK_CIDRS]),
      'dnsmasq.conf': renderDnsmasqConfig(policy, hosts),
      'rules.v4': renderIptablesV4(policy),
      'rules.v6': renderIptablesV6(policy),
      'policy.json': `${JSON.stringify({ revision, mode: policy.mode, logAllowed: policy.logAllowed })}\n`,
    },
  };
}
