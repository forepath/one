import {
  FOREPATH_BILLING_UNIT_TIERS,
  FOREPATH_ON_SITE_TRAVEL_PATTERN,
  type ForepathBillableServiceId,
  inferBillingFloor,
  inferCalibratedServiceIds,
  inferDefaultServiceDescription,
  inferItSystemsRateTier,
  inferMinimumBillingTotal,
  snapBillingUnits,
} from '../constants/forepath-estimate-sizing.constants';
import type {
  ForepathRateTier,
  ForepathServiceId,
  ProjectBreakdown,
  ProjectBreakdownLineItem,
} from '../types/project-estimator.types';

import { normalizeProjectBreakdown } from './forepath-breakdown-normalizer.utils';

const TRAVEL_SERVICE_IDS = new Set<ForepathServiceId>(['travel-km', 'travel-short', 'travel-long']);

const BILLING_SERVICE_IDS: readonly ForepathBillableServiceId[] = ['consulting', 'it-systems', 'software-development'];

export function shouldIncludeTravelInBreakdown(normalizedUserPrompt: string): boolean {
  return FOREPATH_ON_SITE_TRAVEL_PATTERN.test(normalizedUserPrompt);
}

function calibrateBillingLineItem(
  item: ProjectBreakdownLineItem,
  serviceId: ForepathBillableServiceId,
  scopeFloor: number | null,
): ProjectBreakdownLineItem {
  if (item.serviceId !== serviceId || item.billingUnits === undefined) {
    return item;
  }

  let billingUnits = snapBillingUnits(item.billingUnits);

  if (scopeFloor !== null && billingUnits < scopeFloor) {
    billingUnits = scopeFloor;
  }

  return {
    ...item,
    billingUnits,
  };
}

function calibrateItSystemsLineItem(
  item: ProjectBreakdownLineItem,
  normalizedUserPrompt: string,
  scopeFloor: number | null,
): ProjectBreakdownLineItem {
  const calibrated = calibrateBillingLineItem(item, 'it-systems', scopeFloor);
  const inferredRateTier = inferItSystemsRateTier(normalizedUserPrompt);

  return {
    ...calibrated,
    rateTier: item.rateTier ?? inferredRateTier,
  };
}

function sumBillingUnits(lineItems: readonly ProjectBreakdownLineItem[], serviceId: ForepathBillableServiceId): number {
  return lineItems
    .filter((item) => item.serviceId === serviceId)
    .reduce((total, item) => total + (item.billingUnits ?? 0), 0);
}

function reconcileServiceMinimum(
  lineItems: readonly ProjectBreakdownLineItem[],
  serviceId: ForepathBillableServiceId,
  normalizedUserPrompt: string,
): ProjectBreakdownLineItem[] {
  const minimumTotal = inferMinimumBillingTotal(serviceId, normalizedUserPrompt);

  if (minimumTotal === null) {
    return [...lineItems];
  }

  const scopeFloor = inferBillingFloor(serviceId, normalizedUserPrompt);
  const serviceItems = lineItems.filter((item) => item.serviceId === serviceId);
  const otherItems = lineItems.filter((item) => item.serviceId !== serviceId);

  if (serviceItems.length === 0) {
    const injectedItem: ProjectBreakdownLineItem = {
      serviceId,
      description: inferDefaultServiceDescription(serviceId, normalizedUserPrompt),
      billingUnits: minimumTotal,
    };

    if (serviceId === 'it-systems') {
      injectedItem.rateTier = inferItSystemsRateTier(normalizedUserPrompt);
    }

    return [...otherItems, injectedItem];
  }

  const calibratedServiceItems = serviceItems.map((item) =>
    serviceId === 'it-systems'
      ? calibrateItSystemsLineItem(item, normalizedUserPrompt, scopeFloor)
      : calibrateBillingLineItem(item, serviceId, scopeFloor),
  );
  const calibratedTotal = sumBillingUnits(calibratedServiceItems, serviceId);

  if (calibratedTotal >= minimumTotal) {
    return [...otherItems, ...calibratedServiceItems];
  }

  const deficit = minimumTotal - calibratedTotal;
  const largestItemIndex = calibratedServiceItems.reduce(
    (bestIndex, item, index, items) =>
      (item.billingUnits ?? 0) > (items[bestIndex]?.billingUnits ?? 0) ? index : bestIndex,
    0,
  );

  const reconciledServiceItems = calibratedServiceItems.map((item, index) => {
    if (index !== largestItemIndex) {
      return item;
    }

    return {
      ...item,
      billingUnits: snapBillingUnits((item.billingUnits ?? 0) + deficit),
    };
  });

  return [...otherItems, ...reconciledServiceItems];
}

function reconcileAllServiceMinimums(
  lineItems: readonly ProjectBreakdownLineItem[],
  normalizedUserPrompt: string,
): ProjectBreakdownLineItem[] {
  const serviceIds = inferCalibratedServiceIds(normalizedUserPrompt);

  return serviceIds.reduce(
    (currentLineItems, serviceId) => reconcileServiceMinimum(currentLineItems, serviceId, normalizedUserPrompt),
    [...lineItems],
  );
}

function finalizeCalibratedLineItems(
  lineItems: readonly ProjectBreakdownLineItem[],
  normalizedUserPrompt: string,
): ProjectBreakdownLineItem[] {
  return lineItems.map((item) => {
    if (item.serviceId === 'software-development') {
      return calibrateBillingLineItem(
        item,
        'software-development',
        inferBillingFloor('software-development', normalizedUserPrompt),
      );
    }

    if (item.serviceId === 'consulting') {
      return calibrateBillingLineItem(item, 'consulting', inferBillingFloor('consulting', normalizedUserPrompt));
    }

    if (item.serviceId === 'it-systems') {
      return calibrateItSystemsLineItem(
        item,
        normalizedUserPrompt,
        inferBillingFloor('it-systems', normalizedUserPrompt),
      );
    }

    return item;
  });
}

function appendSizingAssumption(
  assumptions: string[],
  serviceId: ForepathBillableServiceId,
  minimumTotal: number,
): void {
  const label =
    serviceId === 'software-development'
      ? 'Software-development'
      : serviceId === 'consulting'
        ? 'Consulting'
        : 'IT systems';

  assumptions.push(
    `${label} effort aligned to the default ${minimumTotal}-unit sizing tier (${minimumTotal / 4} hours).`,
  );
}

export function calibrateProjectBreakdown(breakdown: ProjectBreakdown, normalizedUserPrompt: string): ProjectBreakdown {
  const includeTravel = shouldIncludeTravelInBreakdown(normalizedUserPrompt);

  const filteredLineItems = breakdown.lineItems.filter(
    (item) => includeTravel || !TRAVEL_SERVICE_IDS.has(item.serviceId),
  );

  const reconciledLineItems = reconcileAllServiceMinimums(filteredLineItems, normalizedUserPrompt);
  const calibratedLineItems = finalizeCalibratedLineItems(reconciledLineItems, normalizedUserPrompt);

  const assumptions = [...breakdown.assumptions];

  if (!includeTravel && breakdown.lineItems.some((item) => TRAVEL_SERVICE_IDS.has(item.serviceId))) {
    assumptions.push('Travel costs excluded; ForePath delivers remotely unless on-site work is requested.');
  }

  if (!assumptions.some((assumption) => assumption.toLowerCase().includes('default sizing'))) {
    for (const serviceId of BILLING_SERVICE_IDS) {
      const minimumTotal = inferMinimumBillingTotal(serviceId, normalizedUserPrompt);

      if (minimumTotal !== null && sumBillingUnits(breakdown.lineItems, serviceId) < minimumTotal) {
        appendSizingAssumption(assumptions, serviceId, minimumTotal);
      }
    }
  }

  return normalizeProjectBreakdown({
    ...breakdown,
    lineItems: calibratedLineItems,
    assumptions,
  });
}

export function getSoftwareDevelopmentBillingTiers(): readonly number[] {
  return FOREPATH_BILLING_UNIT_TIERS;
}

export function inferItSystemsRateTierForPrompt(normalizedUserPrompt: string): ForepathRateTier {
  return inferItSystemsRateTier(normalizedUserPrompt);
}
