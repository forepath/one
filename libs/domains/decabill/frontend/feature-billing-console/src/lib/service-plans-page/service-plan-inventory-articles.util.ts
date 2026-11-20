import type { ServicePlanInventoryArticle } from '@forepath/decabill/frontend/data-access-billing-console';

/** Matches the backend limit on articles per plan. */
export const SERVICE_PLAN_INVENTORY_ARTICLES_MAX = 50;

/** Editable row of the "articles per billing period" list (incomplete while the admin is typing). */
export interface ServicePlanInventoryArticleRow {
  articleId: string | null;
  quantity: number | null;
}

export function servicePlanInventoryArticleRowsFromPlan(
  articles: ServicePlanInventoryArticle[] | null | undefined,
): ServicePlanInventoryArticleRow[] {
  return (articles ?? []).map((entry) => ({ articleId: entry.articleId, quantity: Number(entry.quantity) }));
}

/** Quantity > 0 with at most three decimals (backend rule). */
export function isValidServicePlanInventoryQuantity(quantity: number | null | undefined): boolean {
  if (quantity == null) {
    return false;
  }

  const value = Number(quantity);

  if (!Number.isFinite(value) || value <= 0) {
    return false;
  }

  // Same rule as class-validator's maxDecimalPlaces: count the decimals of the number's string form.
  const text = String(value);

  return !/e/i.test(text) && (text.split('.')[1]?.length ?? 0) <= 3;
}

/** Every row complete, at most 50 rows, each article at most once. */
export function areServicePlanInventoryArticleRowsValid(rows: ServicePlanInventoryArticleRow[]): boolean {
  if (rows.length > SERVICE_PLAN_INVENTORY_ARTICLES_MAX) {
    return false;
  }

  const ids = new Set<string>();

  for (const row of rows) {
    if (!row.articleId || ids.has(row.articleId) || !isValidServicePlanInventoryQuantity(row.quantity)) {
      return false;
    }

    ids.add(row.articleId);
  }

  return true;
}

/** True when the row's article was already chosen in an earlier row. */
export function isDuplicateServicePlanInventoryArticle(rows: ServicePlanInventoryArticleRow[], index: number): boolean {
  const articleId = rows[index]?.articleId;

  return !!articleId && rows.slice(0, index).some((row) => row.articleId === articleId);
}

export function servicePlanInventoryArticlesForSubmit(
  rows: ServicePlanInventoryArticleRow[],
): ServicePlanInventoryArticle[] {
  return rows
    .filter((row): row is { articleId: string; quantity: number } => !!row.articleId && row.quantity != null)
    .map((row) => ({ articleId: row.articleId, quantity: Number(row.quantity) }));
}
