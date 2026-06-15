export interface DomainAppPaths {
  domain: string;
  roleName: string;
  projectName: string;
  appRoot: string;
}

export function resolveDomainAppPaths(
  name: string,
  rolePrefix: string,
  options: { domain?: string },
  defaultDomain: string,
): DomainAppPaths {
  const domain = options.domain?.trim() || defaultDomain;
  const roleName = `${rolePrefix}-${name}`;
  const projectName = `${domain}-${roleName}`;
  const appRoot = `apps/${domain}/${roleName}`;

  return { domain, roleName, projectName, appRoot };
}
