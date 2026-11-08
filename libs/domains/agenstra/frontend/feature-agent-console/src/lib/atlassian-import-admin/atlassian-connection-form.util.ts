import type {
  AtlassianConnectionAuthType,
  CreateAtlassianSiteConnectionDto,
  UpdateAtlassianSiteConnectionDto,
} from '@forepath/agenstra/frontend/data-access-agent-console';

/** Default auth variant for new Atlassian connections (OAuth 2.0 client credentials of a service account). */
export const DEFAULT_ATLASSIAN_CONNECTION_AUTH_TYPE: AtlassianConnectionAuthType = 'app';

/** Form model of the create / edit connection modals. */
export interface AtlassianConnectionFormModel {
  label: string;
  baseUrl: string;
  authType: AtlassianConnectionAuthType;
  accountEmail: string;
  apiToken: string;
  oauthClientId: string;
  oauthClientSecret: string;
}

export type AtlassianConnectionFormField =
  | 'baseUrl'
  | 'accountEmail'
  | 'apiToken'
  | 'oauthClientId'
  | 'oauthClientSecret';

export type AtlassianConnectionFormErrorCode = 'required' | 'url' | 'email';

export type AtlassianConnectionFormErrors = Partial<
  Record<AtlassianConnectionFormField, AtlassianConnectionFormErrorCode>
>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function emptyAtlassianConnectionForm(
  authType: AtlassianConnectionAuthType = DEFAULT_ATLASSIAN_CONNECTION_AUTH_TYPE,
): AtlassianConnectionFormModel {
  return { label: '', baseUrl: '', authType, accountEmail: '', apiToken: '', oauthClientId: '', oauthClientSecret: '' };
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);

    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Client-side validation per auth type (the controller validates authoritatively).
 * Secrets are required on create and when an edit switches the auth type (`storedAuthType` differs); otherwise empty
 * secrets keep the stored ones.
 */
export function validateAtlassianConnectionForm(
  form: AtlassianConnectionFormModel,
  storedAuthType: AtlassianConnectionAuthType | null,
): AtlassianConnectionFormErrors {
  const errors: AtlassianConnectionFormErrors = {};
  const requireSecrets = storedAuthType === null || storedAuthType !== form.authType;
  const baseUrl = form.baseUrl.trim();

  if (!baseUrl) {
    errors.baseUrl = 'required';
  } else if (!isHttpUrl(baseUrl)) {
    errors.baseUrl = 'url';
  }

  if (form.authType === 'token') {
    const email = form.accountEmail.trim();

    if (!email) {
      errors.accountEmail = 'required';
    } else if (!EMAIL_PATTERN.test(email)) {
      errors.accountEmail = 'email';
    }

    if (requireSecrets && !form.apiToken.trim()) {
      errors.apiToken = 'required';
    }
  } else {
    if (!form.oauthClientId.trim()) {
      errors.oauthClientId = 'required';
    }

    if (requireSecrets && !form.oauthClientSecret.trim()) {
      errors.oauthClientSecret = 'required';
    }
  }

  return errors;
}

export function hasAtlassianConnectionFormErrors(errors: AtlassianConnectionFormErrors): boolean {
  return Object.keys(errors).length > 0;
}

/** Create payload with only the credentials of the selected auth type. */
export function toCreateAtlassianConnectionDto(form: AtlassianConnectionFormModel): CreateAtlassianSiteConnectionDto {
  const dto: CreateAtlassianSiteConnectionDto = {
    label: form.label.trim() || undefined,
    baseUrl: form.baseUrl.trim(),
    authType: form.authType,
  };

  if (form.authType === 'token') {
    dto.accountEmail = form.accountEmail.trim();
    dto.apiToken = form.apiToken.trim();
  } else {
    dto.oauthClientId = form.oauthClientId.trim();
    dto.oauthClientSecret = form.oauthClientSecret.trim();
  }

  return dto;
}

/** Update payload; empty secrets are omitted so the stored ones are kept. */
export function toUpdateAtlassianConnectionDto(form: AtlassianConnectionFormModel): UpdateAtlassianSiteConnectionDto {
  const dto: UpdateAtlassianSiteConnectionDto = {
    label: form.label.trim() || null,
    baseUrl: form.baseUrl.trim(),
    authType: form.authType,
  };

  if (form.authType === 'token') {
    dto.accountEmail = form.accountEmail.trim();

    if (form.apiToken.trim()) {
      dto.apiToken = form.apiToken.trim();
    }
  } else {
    dto.oauthClientId = form.oauthClientId.trim();

    if (form.oauthClientSecret.trim()) {
      dto.oauthClientSecret = form.oauthClientSecret.trim();
    }
  }

  return dto;
}
