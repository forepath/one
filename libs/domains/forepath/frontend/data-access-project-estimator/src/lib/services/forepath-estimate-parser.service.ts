import { Injectable } from '@angular/core';

import { FOREPATH_SERVICE_IDS } from '../constants/forepath-service-catalog.constants';
import { normalizeProjectBreakdown } from '../utils/forepath-breakdown-normalizer.utils';
import type {
  ForepathRateTier,
  ForepathServiceId,
  ProjectBreakdown,
  ProjectBreakdownLineItem,
} from '../types/project-estimator.types';

const RATE_TIERS: readonly ForepathRateTier[] = ['standard', 'emergency-week', 'emergency-sunday'] as const;
const CONFIDENCE_LEVELS = ['low', 'medium', 'high'] as const;

@Injectable({ providedIn: 'root' })
export class ForepathEstimateParserService {
  parseModelOutput(rawOutput: string): ProjectBreakdown {
    const jsonText = this.extractJson(rawOutput);
    const parsed: unknown = JSON.parse(jsonText);

    return this.validateBreakdown(parsed);
  }

  extractJson(rawOutput: string): string {
    const fencedMatch = rawOutput.match(/```(?:json)?\s*([\s\S]*?)```/i);

    if (fencedMatch?.[1]) {
      return fencedMatch[1].trim();
    }

    const objectStart = rawOutput.indexOf('{');
    const objectEnd = rawOutput.lastIndexOf('}');

    if (objectStart >= 0 && objectEnd > objectStart) {
      return rawOutput.slice(objectStart, objectEnd + 1).trim();
    }

    throw new Error('Model output did not contain JSON.');
  }

  private validateBreakdown(value: unknown): ProjectBreakdown {
    if (!this.isRecord(value)) {
      throw new Error('Breakdown must be an object.');
    }

    const summary = value['summary'];
    const lineItems = value['lineItems'];
    const assumptions = value['assumptions'];
    const confidence = value['confidence'];

    if (typeof summary !== 'string' || summary.trim().length === 0) {
      throw new Error('Breakdown summary is required.');
    }

    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      throw new Error('Breakdown must include at least one line item.');
    }

    if (!Array.isArray(assumptions)) {
      throw new Error('Breakdown assumptions must be an array.');
    }

    if (
      typeof confidence !== 'string' ||
      !CONFIDENCE_LEVELS.includes(confidence as (typeof CONFIDENCE_LEVELS)[number])
    ) {
      throw new Error('Breakdown confidence must be low, medium, or high.');
    }

    return normalizeProjectBreakdown({
      summary: summary.trim(),
      lineItems: lineItems.map((item) => this.validateLineItem(item)),
      assumptions: assumptions.filter((item): item is string => typeof item === 'string' && item.trim().length > 0),
      confidence: confidence as ProjectBreakdown['confidence'],
    });
  }

  private validateLineItem(value: unknown): ProjectBreakdownLineItem {
    if (!this.isRecord(value)) {
      throw new Error('Each line item must be an object.');
    }

    const serviceId = value['serviceId'];
    const description = value['description'];
    const billingUnits = value['billingUnits'];
    const quantity = value['quantity'];
    const rateTier = value['rateTier'];

    if (typeof serviceId !== 'string' || !FOREPATH_SERVICE_IDS.includes(serviceId as ForepathServiceId)) {
      throw new Error(`Invalid serviceId: ${String(serviceId)}`);
    }

    if (typeof description !== 'string' || description.trim().length === 0) {
      throw new Error('Each line item requires a description.');
    }

    const parsedBillingUnits =
      billingUnits === undefined ? undefined : this.parsePositiveNumber(billingUnits, 'billingUnits');
    const parsedQuantity = quantity === undefined ? undefined : this.parsePositiveNumber(quantity, 'quantity');

    let parsedRateTier: ForepathRateTier | undefined;

    if (rateTier !== undefined) {
      if (typeof rateTier !== 'string' || !RATE_TIERS.includes(rateTier as ForepathRateTier)) {
        throw new Error(`Invalid rateTier: ${String(rateTier)}`);
      }

      parsedRateTier = rateTier as ForepathRateTier;
    }

    return {
      serviceId: serviceId as ForepathServiceId,
      description: description.trim(),
      billingUnits: parsedBillingUnits,
      quantity: parsedQuantity,
      rateTier: parsedRateTier,
    };
  }

  private parsePositiveNumber(value: unknown, fieldName: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new Error(`${fieldName} must be a positive number.`);
    }

    return value;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
