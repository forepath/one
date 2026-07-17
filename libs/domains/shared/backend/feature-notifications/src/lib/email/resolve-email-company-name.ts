/**
 * Issuer block for transactional email headers/footers (mirrors invoice "From").
 * Prefer EMAIL_COMPANY_*; Decabill/invoice deployments fall back to BILLING_ISSUER_*.
 */
export interface EmailCompanyFrom {
  name: string;
  lines: string[];
  vatId?: string;
  email?: string;
}

/**
 * Legal / brand name for transactional email headers.
 */
export function resolveEmailCompanyName(): string {
  return resolveEmailCompanyFrom()?.name ?? '';
}

/**
 * Full issuer details for the email layout footer.
 */
export function resolveEmailCompanyFrom(): EmailCompanyFrom | undefined {
  const name = firstEnv('EMAIL_COMPANY_NAME', 'BILLING_ISSUER_NAME');

  if (!name) {
    return undefined;
  }

  const addressLine1 = firstEnv('EMAIL_COMPANY_ADDRESS_LINE1', 'BILLING_ISSUER_ADDRESS_LINE1');
  const postalCode = firstEnv('EMAIL_COMPANY_POSTAL_CODE', 'BILLING_ISSUER_POSTAL_CODE');
  const city = firstEnv('EMAIL_COMPANY_CITY', 'BILLING_ISSUER_CITY');
  const country = resolveCountryLine(firstEnv('EMAIL_COMPANY_COUNTRY', 'BILLING_ISSUER_COUNTRY'));
  const vatId = firstEnv('EMAIL_COMPANY_VAT_ID', 'BILLING_ISSUER_VAT_ID') || undefined;
  const email = firstEnv('EMAIL_COMPANY_EMAIL', 'BILLING_ISSUER_EMAIL') || undefined;
  const cityLine = [postalCode, city].filter((part) => part.length > 0).join(' ');
  const lines = [addressLine1, cityLine, country ?? ''].filter((line) => line.trim().length > 0);

  return {
    name,
    lines,
    ...(vatId ? { vatId } : {}),
    ...(email ? { email } : {}),
  };
}

function firstEnv(...keys: string[]): string {
  for (const key of keys) {
    const value = process.env[key]?.trim();

    if (value) {
      return value;
    }
  }

  return '';
}

function resolveCountryLine(iso2: string): string | undefined {
  const code = iso2.trim().toUpperCase();

  if (!code) {
    return undefined;
  }

  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}
