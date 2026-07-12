import { getTenantIdOrDefault } from '@forepath/shared/backend';
import type { SelectQueryBuilder } from 'typeorm';

export function getRequiredTenantId(): string {
  return getTenantIdOrDefault();
}

export function applyUserTenantFilter<T>(qb: SelectQueryBuilder<T>, userAlias = 'user'): SelectQueryBuilder<T> {
  return qb.andWhere(`${userAlias}.tenant_id = :tenantId`, { tenantId: getRequiredTenantId() });
}

export function applyServiceTypeTenantFilter<T>(qb: SelectQueryBuilder<T>, alias = 'st'): SelectQueryBuilder<T> {
  return qb.andWhere(`${alias}.tenant_id = :tenantId`, { tenantId: getRequiredTenantId() });
}

export function applyPromotionTenantFilter<T>(qb: SelectQueryBuilder<T>, alias = 'promotion'): SelectQueryBuilder<T> {
  return qb.andWhere(`${alias}.tenant_id = :tenantId`, { tenantId: getRequiredTenantId() });
}

export function applyProjectTenantFilter<T>(
  qb: SelectQueryBuilder<T>,
  projectAlias = 'project',
  userAlias = 'user',
): SelectQueryBuilder<T> {
  return qb
    .innerJoin('users', userAlias, `${userAlias}.id = ${projectAlias}.user_id`)
    .andWhere(`${userAlias}.tenant_id = :tenantId`, { tenantId: getRequiredTenantId() });
}
