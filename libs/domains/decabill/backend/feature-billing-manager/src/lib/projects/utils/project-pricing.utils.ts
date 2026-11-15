import { BadRequestException } from '@nestjs/common';

import type { ProjectEntity } from '../entities/project.entity';
import { ProjectPricingModel } from '../entities/project.enums';

/** Amounts below one cent are treated as nothing left to bill. */
export const PROJECT_PRICE_EPSILON = 0.005;

/** Upper bound of `decimal(12,4)` price columns. */
export const PROJECT_PRICE_MAX_NET = 99_999_999;

export interface ProjectPricingTerms {
  pricingModel: ProjectPricingModel;
  hourlyRateNet: number;
  /** Maximum price (`capped`) or fixed price (`fixed`); ignored for `hourly`. */
  priceLimitNet?: number | null;
  /** Net amount already invoiced for project time. */
  billedAmountNet: number;
}

export interface ProjectTimeCharge {
  /** Net amount to invoice for the billed time (rounded to 4 decimals). */
  amountNet: number;
  /** Hours × hourly rate, before any cap / fixed price is applied. */
  timeValueNet: number;
  /** True when the cap reduced the amount below the time value (`capped` only). */
  capApplied: boolean;
}

export function toProjectPricingTerms(
  project: Pick<ProjectEntity, 'pricingModel' | 'hourlyRateNet' | 'priceLimitNet' | 'billedAmountNet'>,
): ProjectPricingTerms {
  return {
    pricingModel: project.pricingModel ?? ProjectPricingModel.HOURLY,
    hourlyRateNet: Number(project.hourlyRateNet),
    priceLimitNet: project.priceLimitNet != null ? Number(project.priceLimitNet) : null,
    billedAmountNet: Number(project.billedAmountNet ?? 0),
  };
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export function isPriceLimitedPricingModel(model: ProjectPricingModel): boolean {
  return model === ProjectPricingModel.CAPPED || model === ProjectPricingModel.FIXED;
}

/** Remaining amount that may still be invoiced under the price limit; null for unlimited hourly projects. */
export function computeProjectRemainingPriceNet(terms: ProjectPricingTerms): number | null {
  if (!isPriceLimitedPricingModel(terms.pricingModel)) {
    return null;
  }

  const remaining = round4(Number(terms.priceLimitNet ?? 0) - Number(terms.billedAmountNet ?? 0));

  return remaining > PROJECT_PRICE_EPSILON ? remaining : 0;
}

/**
 * Net amount to invoice for `billedMinutes` of tracked time.
 * - hourly: hours × rate.
 * - capped: hours × rate, limited to the remaining maximum price.
 * - fixed: `requestedAmountNet` (instalment) or the whole remaining fixed price.
 */
export function computeProjectTimeCharge(
  terms: ProjectPricingTerms,
  billedMinutes: number,
  requestedAmountNet?: number,
): ProjectTimeCharge {
  const timeValueNet = round4((billedMinutes / 60) * Number(terms.hourlyRateNet));

  if (requestedAmountNet !== undefined && terms.pricingModel !== ProjectPricingModel.FIXED) {
    throw new BadRequestException('A custom amount can only be billed for fixed-price projects');
  }

  if (terms.pricingModel === ProjectPricingModel.HOURLY) {
    return { amountNet: timeValueNet, timeValueNet, capApplied: false };
  }

  const remaining = computeProjectRemainingPriceNet(terms) ?? 0;

  if (terms.pricingModel === ProjectPricingModel.CAPPED) {
    const amountNet = Math.min(timeValueNet, remaining);

    return { amountNet, timeValueNet, capApplied: amountNet < timeValueNet };
  }

  if (requestedAmountNet !== undefined) {
    // Enforced here as well as on the DTO: a zero / invalid instalment must never mark time as covered.
    if (typeof requestedAmountNet !== 'number' || !Number.isFinite(requestedAmountNet) || requestedAmountNet < 0.01) {
      throw new BadRequestException('Amount must be a number of at least 0.01');
    }

    if (requestedAmountNet - remaining > PROJECT_PRICE_EPSILON) {
      throw new BadRequestException('Amount exceeds the remaining fixed price');
    }

    return { amountNet: round4(requestedAmountNet), timeValueNet, capApplied: false };
  }

  return { amountNet: remaining, timeValueNet, capApplied: false };
}

/** Open billable amount for unbilled time, respecting the price limit. */
export function computeProjectOpenBillableAmountNet(terms: ProjectPricingTerms, unbilledMinutes: number): number {
  const timeValueNet = (unbilledMinutes / 60) * Number(terms.hourlyRateNet);

  switch (terms.pricingModel) {
    case ProjectPricingModel.CAPPED:
      return Math.min(timeValueNet, computeProjectRemainingPriceNet(terms) ?? 0);
    case ProjectPricingModel.FIXED:
      return computeProjectRemainingPriceNet(terms) ?? 0;
    default:
      return timeValueNet;
  }
}

/**
 * Validates and normalises pricing input: `capped` / `fixed` need a positive price limit, `hourly` never stores one.
 */
export function resolveProjectPricing(
  pricingModel: ProjectPricingModel | undefined,
  priceLimitNet: number | null | undefined,
): { pricingModel: ProjectPricingModel; priceLimitNet: number | null } {
  const model = pricingModel ?? ProjectPricingModel.HOURLY;

  if (!Object.values(ProjectPricingModel).includes(model)) {
    throw new BadRequestException('Unsupported pricing model');
  }

  if (!isPriceLimitedPricingModel(model)) {
    return { pricingModel: model, priceLimitNet: null };
  }

  const limit = priceLimitNet == null ? NaN : Number(priceLimitNet);

  if (typeof priceLimitNet !== 'number' || !Number.isFinite(limit) || limit <= 0 || limit > PROJECT_PRICE_MAX_NET) {
    throw new BadRequestException(
      model === ProjectPricingModel.FIXED
        ? 'A fixed price greater than zero is required'
        : 'A maximum price greater than zero is required',
    );
  }

  return { pricingModel: model, priceLimitNet: limit };
}
