export enum OfferLineType {
  STANDARD = 'standard',
  PROJECT_TEMPLATE = 'project_template',
  PLAN_TEMPLATE = 'plan_template',
  /** Billed like `standard`; accepting the offer raises an inventory withdrawal request. */
  ARTICLE = 'article',
}
