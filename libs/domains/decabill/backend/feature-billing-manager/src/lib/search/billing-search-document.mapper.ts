import type { UserEntity } from '@forepath/identity/backend';

import type { AddonEntity } from '../entities/addon.entity';
import type { BackorderEntity } from '../entities/backorder.entity';
import type { CloudInitConfigEntity } from '../entities/cloud-init-config.entity';
import type { CustomerProfileEntity } from '../entities/customer-profile.entity';
import type { DatevExportEntity } from '../entities/datev-export.entity';
import type { InvoiceEntity } from '../entities/invoice.entity';
import type { OfferEntity } from '../offers/entities/offer.entity';
import type { MeterEntity } from '../entities/meter.entity';
import type { PromotionEntity } from '../entities/promotion.entity';
import type { ServicePlanEntity } from '../entities/service-plan.entity';
import type { ServiceTypeEntity } from '../entities/service-type.entity';
import type { SubscriptionEntity } from '../entities/subscription.entity';
import type { ProjectMilestoneEntity } from '../projects/entities/project-milestone.entity';
import type { ProjectTicketEntity } from '../projects/entities/project-ticket.entity';
import type { ProjectTimeEntryEntity } from '../projects/entities/project-time-entry.entity';
import type { ProjectEntity } from '../projects/entities/project.entity';

import type { BillingSearchDocument, BillingSearchEntityType } from './billing-search.types';
import { resolveServiceTypeAllowedProviders } from '../utils/provider-selection.utils';

function text(value: string | number | null | undefined): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  const normalized = String(value).trim();

  return normalized.length > 0 ? normalized : undefined;
}

function baseDoc(
  entityType: BillingSearchEntityType,
  id: string,
  tenantId: string,
  fields: Record<string, string | number | boolean | null | undefined>,
): BillingSearchDocument {
  const document: BillingSearchDocument = {
    id,
    tenantId,
    entityType,
  };

  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }

    document[key] = value;
  }

  return document;
}

export function mapSubscriptionToSearchDocument(
  subscription: SubscriptionEntity,
  tenantId: string,
  extras?: { planName?: string | null; userEmail?: string | null },
): BillingSearchDocument {
  return baseDoc('subscriptions', subscription.id, tenantId, {
    number: text(subscription.number),
    status: text(subscription.status),
    userId: text(subscription.userId),
    planId: text(subscription.planId),
    planName: text(extras?.planName ?? undefined),
    userEmail: text(extras?.userEmail ?? undefined),
  });
}

export function mapInvoiceToSearchDocument(
  invoice: InvoiceEntity,
  tenantId: string,
  extras?: { subscriptionNumber?: string | null; userEmail?: string | null },
): BillingSearchDocument {
  return baseDoc('invoices', invoice.id, tenantId, {
    invoiceNumber: text(invoice.invoiceNumber),
    status: text(invoice.status),
    userId: text(invoice.userId),
    subscriptionId: text(invoice.subscriptionId),
    projectId: text(invoice.projectId),
    offerId: text(invoice.offerId),
    subscriptionNumber: text(extras?.subscriptionNumber ?? undefined),
    userEmail: text(extras?.userEmail ?? undefined),
  });
}

export function mapOfferToSearchDocument(
  offer: OfferEntity,
  tenantId: string,
  extras?: { userEmail?: string | null },
): BillingSearchDocument {
  return baseDoc('offers', offer.id, tenantId, {
    offerNumber: text(offer.offerNumber),
    status: text(offer.status),
    userId: text(offer.userId),
    userEmail: text(extras?.userEmail ?? undefined),
  });
}

export function mapProjectToSearchDocument(project: ProjectEntity, tenantId: string): BillingSearchDocument {
  return baseDoc('projects', project.id, tenantId, {
    name: text(project.name),
    description: text(project.description),
    status: text(project.status),
    userId: text(project.userId),
  });
}

export function mapTicketToSearchDocument(ticket: ProjectTicketEntity, tenantId: string): BillingSearchDocument {
  return baseDoc('tickets', ticket.id, tenantId, {
    title: text(ticket.title),
    content: text(ticket.content),
    status: text(ticket.status),
    priority: text(ticket.priority),
    projectId: text(ticket.projectId),
    parentId: text(ticket.parentId),
    milestoneId: text(ticket.milestoneId),
  });
}

export function mapPromotionToSearchDocument(promotion: PromotionEntity): BillingSearchDocument {
  return baseDoc('promotions', promotion.id, promotion.tenantId, {
    code: text(promotion.code),
    name: text(promotion.name),
    description: text(promotion.description),
  });
}

export function mapCustomerProfileToSearchDocument(
  profile: CustomerProfileEntity,
  tenantId: string,
): BillingSearchDocument {
  return baseDoc('customer-profiles', profile.id, tenantId, {
    customerNumber: text(profile.customerNumber),
    firstName: text(profile.firstName),
    lastName: text(profile.lastName),
    company: text(profile.company),
    email: text(profile.email),
    city: text(profile.city),
    country: text(profile.country),
    vatId: text(profile.vatId),
    userId: text(profile.userId),
    phone: text(profile.phone),
    // Intentionally omit stripeCustomerId, customData, payment method ids
  });
}

export function mapServicePlanToSearchDocument(plan: ServicePlanEntity): BillingSearchDocument {
  return baseDoc('service-plans', plan.id, plan.tenantId, {
    name: text(plan.name),
    description: text(plan.description),
    serviceTypeId: text(plan.serviceTypeId),
  });
}

export function mapServiceTypeToSearchDocument(serviceType: ServiceTypeEntity): BillingSearchDocument {
  const primaryProvider = resolveServiceTypeAllowedProviders(serviceType)[0] ?? serviceType.provider ?? null;

  return baseDoc('service-types', serviceType.id, serviceType.tenantId, {
    key: text(serviceType.key),
    name: text(serviceType.name),
    description: text(serviceType.description),
    provider: text(primaryProvider),
    // Intentionally omit providerDefaults / configSchema secrets
  });
}

export function mapMeterToSearchDocument(meter: MeterEntity): BillingSearchDocument {
  return baseDoc('meters', meter.id, meter.tenantId, {
    key: text(meter.key),
    name: text(meter.name),
    description: text(meter.description),
    unitLabel: text(meter.unitLabel),
  });
}

export function mapAddonToSearchDocument(addon: AddonEntity): BillingSearchDocument {
  return baseDoc('addons', addon.id, addon.tenantId, {
    key: text(addon.key),
    name: text(addon.name),
    description: text(addon.description),
    // Intentionally omit script templates / encrypted config
  });
}

export function mapCloudInitConfigToSearchDocument(config: CloudInitConfigEntity): BillingSearchDocument {
  return baseDoc('cloud-init-configs', config.id, config.tenantId, {
    key: text(config.key),
    name: text(config.name),
    description: text(config.description),
    provisioningMode: text(config.provisioningMode),
    // Intentionally omit templates / encrypted defaults
  });
}

export function mapDatevExportToSearchDocument(exportRow: DatevExportEntity): BillingSearchDocument {
  return baseDoc('datev-exports', exportRow.id, exportRow.tenantId, {
    fileName: text(exportRow.fileName),
    status: text(exportRow.status),
    scope: text(exportRow.scope),
    periodYear: exportRow.periodYear,
    periodMonth: exportRow.periodMonth,
  });
}

export function mapTimeEntryToSearchDocument(entry: ProjectTimeEntryEntity, tenantId: string): BillingSearchDocument {
  return baseDoc('time-entries', entry.id, tenantId, {
    description: text(entry.description),
    projectId: text(entry.projectId),
    ticketId: text(entry.ticketId),
    recordedByUserId: text(entry.recordedByUserId),
  });
}

export function mapMilestoneToSearchDocument(
  milestone: ProjectMilestoneEntity,
  tenantId: string,
): BillingSearchDocument {
  return baseDoc('milestones', milestone.id, tenantId, {
    name: text(milestone.name),
    description: text(milestone.description),
    projectId: text(milestone.projectId),
  });
}

export function mapUserToSearchDocument(user: UserEntity): BillingSearchDocument {
  return baseDoc('users', user.id, user.tenantId, {
    email: text(user.email),
    role: text(user.role),
    // Intentionally omit password hashes and auth tokens
  });
}

export function mapBackorderToSearchDocument(backorder: BackorderEntity, tenantId: string): BillingSearchDocument {
  return baseDoc('backorders', backorder.id, tenantId, {
    status: text(backorder.status),
    failureReason: text(backorder.failureReason),
    userId: text(backorder.userId),
    planId: text(backorder.planId),
    serviceTypeId: text(backorder.serviceTypeId),
    // Intentionally omit requestedConfigSnapshot
  });
}
