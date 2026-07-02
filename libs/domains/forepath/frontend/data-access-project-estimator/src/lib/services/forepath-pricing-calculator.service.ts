import { Injectable } from '@angular/core';

import {
  FOREPATH_ESTIMATE_DISCLAIMER,
  FOREPATH_SERVICE_CATALOG,
  getServiceCatalogEntry,
} from '../constants/forepath-service-catalog.constants';
import type {
  ForepathRateTier,
  ForepathServiceId,
  ProjectBreakdown,
  ProjectBreakdownLineItem,
  ProjectEstimate,
  ProjectEstimateLineItem,
} from '../types/project-estimator.types';

@Injectable({ providedIn: 'root' })
export class ForepathPricingCalculatorService {
  calculateEstimate(breakdown: ProjectBreakdown): ProjectEstimate {
    const lineItems = breakdown.lineItems.map((item) => this.toEstimateLineItem(item));

    const subtotalNet = lineItems.reduce((total, item) => total + item.lineTotal, 0);

    return {
      summary: breakdown.summary,
      lineItems,
      subtotalNet: this.roundCurrency(subtotalNet),
      assumptions: breakdown.assumptions,
      confidence: breakdown.confidence,
      disclaimer: FOREPATH_ESTIMATE_DISCLAIMER,
    };
  }

  private toEstimateLineItem(item: ProjectBreakdownLineItem): ProjectEstimateLineItem {
    const catalogEntry = getServiceCatalogEntry(item.serviceId);

    if (!catalogEntry) {
      throw new Error(`Unknown service id: ${item.serviceId}`);
    }

    const rateTier = this.resolveRateTier(item);
    const unitPrice = this.resolveUnitPrice(item.serviceId, rateTier);
    const unitLabel = catalogEntry.unitLabel;
    const quantity = this.resolveQuantity(item);
    const lineTotal = this.roundCurrency(unitPrice * quantity);

    return {
      serviceId: item.serviceId,
      serviceName: catalogEntry.name,
      description: item.description,
      billingUnits: item.billingUnits,
      quantity: item.quantity,
      rateTier,
      unitLabel,
      unitPrice,
      lineTotal,
    };
  }

  private resolveRateTier(item: ProjectBreakdownLineItem): ForepathRateTier | undefined {
    if (item.serviceId !== 'it-systems') {
      return undefined;
    }

    return item.rateTier ?? 'standard';
  }

  private resolveUnitPrice(serviceId: ForepathServiceId, rateTier?: ForepathRateTier): number {
    const catalogEntry = getServiceCatalogEntry(serviceId);

    if (!catalogEntry) {
      throw new Error(`Unknown service id: ${serviceId}`);
    }

    if (catalogEntry.supportsRateTier) {
      const tier = rateTier ?? 'standard';
      const tierRate = catalogEntry.rates[tier];

      if (tierRate === undefined) {
        throw new Error(`Missing rate tier ${tier} for service ${serviceId}`);
      }

      return tierRate;
    }

    return catalogEntry.rates.standard ?? 0;
  }

  private resolveQuantity(item: ProjectBreakdownLineItem): number {
    if (item.serviceId === 'travel-km' || item.serviceId === 'travel-long') {
      if (item.quantity === undefined || item.quantity <= 0) {
        throw new Error(`Quantity is required for service ${item.serviceId}`);
      }

      return item.quantity;
    }

    if (item.serviceId === 'travel-short') {
      return 1;
    }

    if (item.billingUnits === undefined || item.billingUnits <= 0) {
      throw new Error(`Billing units are required for service ${item.serviceId}`);
    }

    return item.billingUnits;
  }

  private roundCurrency(value: number): number {
    return Math.round(value * 100) / 100;
  }

  buildCatalogPromptContext(compact = false): string {
    if (compact) {
      return JSON.stringify(
        FOREPATH_SERVICE_CATALOG.map((entry) => ({
          id: entry.id,
          name: entry.name,
          unit: entry.unitLabel,
          rate: entry.rates.standard,
        })),
      );
    }

    return JSON.stringify(
      FOREPATH_SERVICE_CATALOG.map((entry) => ({
        id: entry.id,
        name: entry.name,
        description: entry.description,
        unitLabel: entry.unitLabel,
        supportsRateTier: entry.supportsRateTier,
        rates: entry.rates,
      })),
      null,
      2,
    );
  }
}
