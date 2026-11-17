import type {
  OfferArticleLineDto,
  OfferLineInputDto,
  OfferLineResponse,
  OfferLineType,
  OfferPlanTemplateLineDto,
  OfferProjectTemplateLineDto,
  OfferStandardLineDto,
  ProjectPricingModel,
  TaxCategory,
} from '@forepath/decabill/frontend/data-access-billing-console';

export interface OfferFormLineItem {
  lineType: OfferLineType;
  description: string;
  quantity: number;
  unitPriceNet: number;
  unitLabel: string;
  taxCategory: TaxCategory;
  /** `article` lines: the inventory article withdrawn (as request) when the offer is accepted. */
  inventoryArticleId: string | null;
  name: string;
  projectDescription: string;
  hourlyRateNet: number;
  targetHours: number | null;
  pricingModel: ProjectPricingModel;
  /** Maximum (`capped`) or fixed price (`fixed`), net. */
  priceLimitNet: number | null;
  planId: string;
  promotionCode: string;
  requestedConfig: Record<string, unknown>;
  addonIds: string[];
  addonConfigs: Record<string, Record<string, string>>;
  autoBackorder: boolean;
  scheduledAt: string;
}

export function createEmptyOfferFormLine(lineType: OfferLineType = 'standard'): OfferFormLineItem {
  return {
    lineType,
    description: '',
    quantity: 1,
    unitPriceNet: 0,
    unitLabel: '',
    taxCategory: 'standard',
    inventoryArticleId: null,
    name: '',
    projectDescription: '',
    hourlyRateNet: 0,
    targetHours: null,
    pricingModel: 'hourly',
    priceLimitNet: null,
    planId: '',
    promotionCode: '',
    requestedConfig: {},
    addonIds: [],
    addonConfigs: {},
    autoBackorder: false,
    scheduledAt: '',
  };
}

export function mapOfferFormLinesToDto(lines: OfferFormLineItem[]): OfferLineInputDto[] {
  return lines.map((line) => {
    switch (line.lineType) {
      case 'project_template': {
        const payload: OfferProjectTemplateLineDto = {
          description: line.description.trim(),
          name: line.name.trim(),
          hourlyRateNet: line.hourlyRateNet,
        };

        if (line.projectDescription.trim()) {
          payload.projectDescription = line.projectDescription.trim();
        }

        if (line.targetHours != null && line.targetHours > 0) {
          payload.targetHours = line.targetHours;
        }

        if (isPriceLimitedPricingModel(line.pricingModel)) {
          payload.pricingModel = line.pricingModel;
          payload.priceLimitNet = Number(line.priceLimitNet);
        }

        if (line.scheduledAt.trim()) {
          payload.scheduledAt = toIsoDateTime(line.scheduledAt);
        }

        return { lineType: 'project_template', payload };
      }

      case 'plan_template': {
        const payload: OfferPlanTemplateLineDto = {
          description: line.description.trim(),
          planId: line.planId.trim(),
        };

        if (Object.keys(line.requestedConfig).length > 0) {
          payload.requestedConfig = line.requestedConfig;
        }

        if (line.addonIds.length > 0) {
          payload.addonIds = [...line.addonIds];
        }

        const addonConfigs = buildOfferPlanAddonConfigs(line.addonConfigs);

        if (addonConfigs) {
          payload.addonConfigs = addonConfigs;
        }

        if (line.autoBackorder) {
          payload.autoBackorder = true;
        }

        if (line.promotionCode.trim()) {
          payload.promotionCode = line.promotionCode.trim();
        }

        if (line.scheduledAt.trim()) {
          payload.scheduledAt = toIsoDateTime(line.scheduledAt);
        }

        return { lineType: 'plan_template', payload };
      }

      case 'article': {
        const payload: OfferArticleLineDto = {
          ...buildStandardLinePayload(line),
          inventoryArticleId: line.inventoryArticleId ?? '',
        };

        return { lineType: 'article', payload };
      }

      default:
        return { lineType: 'standard', payload: buildStandardLinePayload(line) };
    }
  });
}

function buildStandardLinePayload(line: OfferFormLineItem): OfferStandardLineDto {
  const payload: OfferStandardLineDto = {
    description: line.description.trim(),
    quantity: line.quantity,
    unitPriceNet: line.unitPriceNet,
    taxCategory: line.taxCategory === 'reduced' ? 'reduced' : 'standard',
  };

  if (line.unitLabel.trim()) {
    payload.unitLabel = line.unitLabel.trim();
  }

  if (line.scheduledAt.trim()) {
    payload.scheduledAt = toIsoDateTime(line.scheduledAt);
  }

  return payload;
}

export function mapOfferDetailLinesToForm(lines: OfferLineResponse[]): OfferFormLineItem[] {
  return lines.map((line) => {
    const base = createEmptyOfferFormLine(line.lineType);

    base.description = line.description;
    base.scheduledAt = toLocalDateTimeInput(line.scheduledAt);

    if (isStandardLikeOfferLineType(line.lineType)) {
      base.quantity = line.quantity;
      base.unitPriceNet = line.unitPriceNet;
      base.unitLabel = line.unitLabel ?? '';
      base.taxCategory = line.taxCategory === 'reduced' ? 'reduced' : 'standard';
    }

    if (line.lineType === 'article') {
      base.inventoryArticleId = line.inventoryArticleId ?? null;
    }

    if (line.lineType === 'project_template') {
      const payload = line.projectTemplatePayload ?? {};

      base.name = typeof payload['name'] === 'string' ? payload['name'] : '';
      base.projectDescription = typeof payload['description'] === 'string' ? payload['description'] : '';
      base.hourlyRateNet = typeof payload['hourlyRateNet'] === 'number' ? payload['hourlyRateNet'] : line.unitPriceNet;
      base.pricingModel = isPriceLimitedPricingModel(payload['pricingModel']) ? payload['pricingModel'] : 'hourly';
      base.priceLimitNet =
        base.pricingModel !== 'hourly' && typeof payload['priceLimitNet'] === 'number'
          ? payload['priceLimitNet']
          : null;
      base.targetHours =
        typeof payload['targetHours'] === 'number'
          ? payload['targetHours']
          : base.pricingModel === 'hourly'
            ? line.quantity
            : null;
    }

    if (line.lineType === 'plan_template') {
      base.planId = line.planId ?? '';
      base.promotionCode = '';
      base.requestedConfig = line.requestedConfig ?? {};
      base.addonIds = line.addonIds ? [...line.addonIds] : [];
      base.addonConfigs = line.addonConfigs ? structuredClone(line.addonConfigs) : {};
      base.autoBackorder = false;
    }

    return base;
  });
}

export function isOfferFormValid(lines: OfferFormLineItem[]): boolean {
  if (lines.length === 0) {
    return false;
  }

  return lines.every((line) => {
    if (!line.description.trim()) {
      return false;
    }

    if (line.lineType === 'article' && !line.inventoryArticleId) {
      return false;
    }

    if (isStandardLikeOfferLineType(line.lineType)) {
      return line.quantity > 0 && line.unitPriceNet >= 0;
    }

    if (line.lineType === 'project_template') {
      return line.name.trim().length > 0 && line.hourlyRateNet >= 0 && hasValidOfferProjectPriceLimit(line);
    }

    return line.planId.trim().length > 0;
  });
}

/** `article` lines are priced and billed like `standard` lines. */
export function isStandardLikeOfferLineType(lineType: OfferLineType): boolean {
  return lineType === 'standard' || lineType === 'article';
}

export function isPriceLimitedPricingModel(value: unknown): value is 'capped' | 'fixed' {
  return value === 'capped' || value === 'fixed';
}

/** Capped / fixed project lines need a positive maximum / fixed price. */
export function hasValidOfferProjectPriceLimit(
  line: Pick<OfferFormLineItem, 'pricingModel' | 'priceLimitNet'>,
): boolean {
  if (!isPriceLimitedPricingModel(line.pricingModel)) {
    return true;
  }

  const limit = Number(line.priceLimitNet);

  return line.priceLimitNet != null && Number.isFinite(limit) && limit > 0;
}

function toIsoDateTime(value: string): string {
  return new Date(value).toISOString();
}

function buildOfferPlanAddonConfigs(
  addonConfigs: Record<string, Record<string, string>>,
): Record<string, unknown> | undefined {
  const entries = Object.entries(addonConfigs).filter(([, values]) => Object.keys(values).length > 0);

  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries);
}

function toLocalDateTimeInput(value?: string | null): string {
  if (!value) {
    return '';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);

  return local.toISOString().slice(0, 16);
}
