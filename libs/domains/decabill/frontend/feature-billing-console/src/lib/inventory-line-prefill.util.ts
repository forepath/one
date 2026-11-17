import type { InventoryArticle, TaxCategory } from '@forepath/decabill/frontend/data-access-billing-console';

/** Line fields an article pick may prefill (offer lines carry a unit label, invoice lines do not). */
export interface InventoryPrefillableLine {
  description: string;
  unitPriceNet: number;
  taxCategory?: TaxCategory;
  unitLabel?: string;
}

/**
 * Prefills a sales line from a picked article, in place: the net sales price (only when the article has one), the
 * article name and unit label (only into empty fields) and the tax category. The purchase price is not used by sales
 * documents. Clearing the article (`null`) leaves the line untouched.
 */
export function applyInventoryArticlePrefill<T extends InventoryPrefillableLine>(
  line: T,
  article: Pick<InventoryArticle, 'name' | 'unit' | 'salesPriceNet' | 'taxCategory'> | null,
  unitLabel: (unit: string) => string = (unit) => unit,
): T {
  if (!article) {
    return line;
  }

  if (article.salesPriceNet != null && Number.isFinite(Number(article.salesPriceNet))) {
    line.unitPriceNet = Number(article.salesPriceNet);
  }

  if (!line.description.trim() && article.name?.trim()) {
    line.description = article.name.trim();
  }

  if (line.unitLabel !== undefined && !line.unitLabel.trim() && article.unit) {
    line.unitLabel = unitLabel(article.unit);
  }

  if (article.taxCategory === 'standard' || article.taxCategory === 'reduced') {
    line.taxCategory = article.taxCategory;
  }

  return line;
}

/** Manual invoice positions: `article` positions raise an inventory withdrawal request for their quantity on issue. */
export type InvoicePositionType = 'standard' | 'article';

export interface InvoicePositionFields {
  positionType: InvoicePositionType;
  inventoryArticleId?: string | null;
}

/** Article positions need an article; standard positions are always valid here. */
export function hasValidInventoryPosition(line: InvoicePositionFields): boolean {
  return line.positionType !== 'article' || !!line.inventoryArticleId;
}

/** `{ inventoryArticleId }` for article positions, `{}` otherwise (standard payloads stay unchanged). */
export function inventoryPositionPayload(line: InvoicePositionFields): { inventoryArticleId?: string } {
  return line.positionType === 'article' && line.inventoryArticleId
    ? { inventoryArticleId: line.inventoryArticleId }
    : {};
}
