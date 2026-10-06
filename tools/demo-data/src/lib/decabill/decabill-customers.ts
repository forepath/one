import { ACCOUNT_STATES, buildPersonalAccessTokenRows, buildUserRow } from '../core/accounts';
import { createPerson, createVatId, DemoPerson } from '../core/people';

import { datevAccountNumber, DecabillTenantContext, DemoCustomer, scopedNumber } from './decabill-context';

const DECABILL_PAT_SCOPES = ['invoices:read', 'subscriptions:read', 'usage:read', 'usage:write', 'catalog:write'];
/** Number of additional random customers per tenant on top of one user per account state. */
const RANDOM_CUSTOMERS_PER_TENANT = 14;

export interface DecabillUsers {
  admins: { userId: string; email: string }[];
  /** Customers eligible for commerce data (confirmed or locked, with a profile). */
  customers: DemoCustomer[];
}

export async function buildUsers(context: DecabillTenantContext): Promise<DecabillUsers> {
  const { random, rows, tenantId, emailDomain } = context;
  const usedLocalParts = new Set<string>();
  const admins: DecabillUsers['admins'] = [];
  const customers: DemoCustomer[] = [];
  const profileVariants = random.deck(['complete', 'complete', 'complete', 'incomplete', 'none'] as const);

  for (const state of ACCOUNT_STATES) {
    const userId = random.id();
    const email = `${state.key}@${emailDomain}`;
    const createdAt = random.daysAgo(random.int(200, 700));

    usedLocalParts.add(state.key);
    rows.add(
      'users',
      await buildUserRow({
        id: userId,
        tenantId,
        email,
        state,
        createdAt,
        random,
        hasher: context.hasher,
        encryptor: context.encryptor,
      }),
    );

    if (state.role === 'admin') {
      admins.push({ userId, email });
      rows.addMany(
        'user_personal_access_tokens',
        await buildPersonalAccessTokenRows(random, context.hasher, userId, DECABILL_PAT_SCOPES),
      );

      continue;
    }

    if (!state.confirmed) {
      continue;
    }

    // The fixed-state accounts always get a complete profile so their pages are filled.
    customers.push(addCustomerProfile(context, userId, email, createPerson(random, usedLocalParts), 'complete'));
  }

  for (let i = 0; i < RANDOM_CUSTOMERS_PER_TENANT; i++) {
    const person = createPerson(random, usedLocalParts);
    const userId = random.id();
    const email = `${person.emailLocalPart}@${emailDomain}`;
    const createdAt = random.daysAgo(random.int(30, 900));
    const variant = profileVariants();

    rows.add(
      'users',
      await buildUserRow({
        id: userId,
        tenantId,
        email,
        state: ACCOUNT_STATES.find((state) => state.key === 'user')!,
        createdAt,
        random,
        hasher: context.hasher,
        encryptor: context.encryptor,
      }),
    );

    if (variant === 'none') {
      continue;
    }

    const customer = addCustomerProfile(context, userId, email, person, variant);

    if (variant === 'complete') {
      customers.push(customer);
    }
  }

  return { admins, customers };
}

function addCustomerProfile(
  context: DecabillTenantContext,
  userId: string,
  email: string,
  person: DemoPerson,
  variant: 'complete' | 'incomplete',
): DemoCustomer {
  const { random, rows, encryptor, numberScope } = context;
  const business = person.company !== null;
  const vatId = business ? createVatId(random, person.location) : null;
  const vatStatus = vatId ? random.pick(['valid', 'valid', 'valid', 'pending', 'invalid', 'unavailable']) : 'none';
  const trustScore = random.int(5, 99);
  const trustLevel = trustScore >= 70 ? 'green' : trustScore >= 35 ? 'yellow' : 'red';
  const complete = variant === 'complete';
  const autoBilling = complete && random.chance(0.35);
  const createdAt = random.daysAgo(random.int(30, 600));

  rows.add('billing_customer_profiles', {
    id: random.id(),
    user_id: userId,
    customer_number: scopedNumber('CUS', 'billing_customer_number_sequences', numberScope, 6),
    number_scope: numberScope,
    first_name: person.firstName,
    last_name: person.lastName,
    company: person.company,
    customer_type: business ? 'business' : 'consumer',
    vat_id: vatId,
    vat_id_validation_status: vatStatus,
    vat_id_validated_at: vatStatus === 'valid' || vatStatus === 'invalid' ? random.daysAgo(random.int(1, 90)) : null,
    vat_id_validation_source: vatStatus === 'none' ? null : random.pick(['vies_sync', 'vies_async', 'admin']),
    address_line_1: complete ? person.addressLine1 : null,
    address_line_2: complete ? person.addressLine2 : null,
    postal_code: complete ? person.location.postalCode : null,
    city: person.location.city,
    state: person.location.state ?? null,
    country: complete ? person.location.country : null,
    email,
    phone: random.chance(0.7) ? person.phone : null,
    stripe_customer_id: autoBilling ? `cus_demo${random.alphanumeric(14)}` : null,
    auto_billing_enabled: autoBilling,
    default_payment_method_external_id: autoBilling ? `pm_demo${random.alphanumeric(14)}` : null,
    trust_score: complete ? trustScore : null,
    trust_level: complete ? trustLevel : null,
    trust_score_updated_at: complete ? random.daysAgo(random.int(0, 7)) : null,
    custom_data: encryptor.encryptJson(
      random.chance(0.5)
        ? { crmId: `CRM-${random.int(10000, 99999)}`, segment: random.pick(['SMB', 'Enterprise']) }
        : {},
    ),
    created_at: createdAt,
    updated_at: random.addDays(createdAt, random.int(0, 20)),
  });

  if (complete) {
    rows.add('billing_datev_debtor_accounts', {
      id: random.id(),
      tenant_id: context.tenantId,
      user_id: userId,
      allocation_scope: numberScope,
      debtor_number: datevAccountNumber('debtor', numberScope, context.datevCounters.debtor++),
      created_at: createdAt,
    });
  }

  return {
    userId,
    email,
    person,
    country: person.location.country,
    customerType: business ? 'business' : 'consumer',
    vatId: vatStatus === 'invalid' ? null : vatId,
    hasCompleteProfile: complete,
    autoBilling,
  };
}
