import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/decabill/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/decabill/frontend/util-configuration';
import { Observable } from 'rxjs';

import type {
  InventoryArticle,
  InventoryArticleInput,
  InventoryCompartment,
  InventoryCompartmentInput,
  InventoryLabelOwner,
  InventoryLabelRequest,
  InventoryLending,
  InventoryLendingFilters,
  InventoryLendingInput,
  InventoryLendingReturnInput,
  InventoryListParams,
  InventoryMovement,
  InventoryMovementFilters,
  InventoryPutawayInput,
  InventoryRequestAllocation,
  InventorySerialUnit,
  InventorySerialUnitFilters,
  InventoryStock,
  InventorySummary,
  InventoryTransferInput,
  InventoryWarehouse,
  InventoryWarehouseInput,
  InventoryWithdrawalInput,
  InventoryWithdrawalRequest,
  InventoryWithdrawalRequestStatus,
  PaginatedInventoryResponse,
} from '../types/inventory.types';
import type { SpoolJob } from '../types/spooler.types';

import { AdminSpoolerService } from './admin-spooler.service';

type QueryValue = string | number | boolean | null | undefined;

function toParams(values: Record<string, QueryValue>): HttpParams {
  let params = new HttpParams();

  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined) continue;

    const text = typeof value === 'string' ? value.trim() : String(value);

    if (text !== '') params = params.set(key, text);
  }

  return params;
}

/** Admin inventory API (`/admin/billing/inventory`, scope `inventory:admin`). All lists are replace-page. */
@Injectable({
  providedIn: 'root',
})
export class AdminInventoryService {
  private readonly http = inject(HttpClient);
  private readonly spooler = inject(AdminSpoolerService);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  private get baseUrl(): string {
    return `${this.environment.billing.urls.restApi}/admin/billing/inventory`;
  }

  getSummary(): Observable<InventorySummary> {
    return this.http.get<InventorySummary>(`${this.baseUrl}/summary`);
  }

  // ---- Warehouses ----

  listWarehouses(params: InventoryListParams = {}): Observable<PaginatedInventoryResponse<InventoryWarehouse>> {
    return this.http.get<PaginatedInventoryResponse<InventoryWarehouse>>(`${this.baseUrl}/warehouses`, {
      params: toParams({ ...params }),
    });
  }

  getWarehouse(id: string): Observable<InventoryWarehouse> {
    return this.http.get<InventoryWarehouse>(`${this.baseUrl}/warehouses/${id}`);
  }

  createWarehouse(dto: InventoryWarehouseInput): Observable<InventoryWarehouse> {
    return this.http.post<InventoryWarehouse>(`${this.baseUrl}/warehouses`, dto);
  }

  updateWarehouse(id: string, dto: InventoryWarehouseInput): Observable<InventoryWarehouse> {
    return this.http.post<InventoryWarehouse>(`${this.baseUrl}/warehouses/${id}`, dto);
  }

  deleteWarehouse(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/warehouses/${id}`);
  }

  // ---- Compartments ----

  /** Without `warehouseId`: compartments of all warehouses (typeahead). */
  listCompartments(
    params: InventoryListParams & { warehouseId?: string; activeOnly?: boolean } = {},
  ): Observable<PaginatedInventoryResponse<InventoryCompartment>> {
    return this.http.get<PaginatedInventoryResponse<InventoryCompartment>>(`${this.baseUrl}/compartments`, {
      params: toParams({ ...params }),
    });
  }

  getCompartment(id: string): Observable<InventoryCompartment> {
    return this.http.get<InventoryCompartment>(`${this.baseUrl}/compartments/${id}`);
  }

  createCompartment(warehouseId: string, dto: InventoryCompartmentInput): Observable<InventoryCompartment> {
    return this.http.post<InventoryCompartment>(`${this.baseUrl}/warehouses/${warehouseId}/compartments`, dto);
  }

  updateCompartment(id: string, dto: InventoryCompartmentInput): Observable<InventoryCompartment> {
    return this.http.post<InventoryCompartment>(`${this.baseUrl}/compartments/${id}`, dto);
  }

  deleteCompartment(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/compartments/${id}`);
  }

  listCompartmentStock(
    compartmentId: string,
    params: InventoryListParams = {},
  ): Observable<PaginatedInventoryResponse<InventoryStock>> {
    return this.http.get<PaginatedInventoryResponse<InventoryStock>>(
      `${this.baseUrl}/compartments/${compartmentId}/stock`,
      { params: toParams({ ...params }) },
    );
  }

  // ---- Articles ----

  listArticles(
    params: InventoryListParams & { activeOnly?: boolean; lowStockOnly?: boolean } = {},
  ): Observable<PaginatedInventoryResponse<InventoryArticle>> {
    return this.http.get<PaginatedInventoryResponse<InventoryArticle>>(`${this.baseUrl}/articles`, {
      params: toParams({ ...params }),
    });
  }

  getArticle(id: string): Observable<InventoryArticle> {
    return this.http.get<InventoryArticle>(`${this.baseUrl}/articles/${id}`);
  }

  createArticle(dto: InventoryArticleInput): Observable<InventoryArticle> {
    return this.http.post<InventoryArticle>(`${this.baseUrl}/articles`, dto);
  }

  updateArticle(id: string, dto: InventoryArticleInput): Observable<InventoryArticle> {
    return this.http.post<InventoryArticle>(`${this.baseUrl}/articles/${id}`, dto);
  }

  deleteArticle(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/articles/${id}`);
  }

  /** Locations of an article, most stock first (also the move suggestions). */
  listArticleStock(
    articleId: string,
    params: InventoryListParams & { withStockOnly?: boolean } = {},
  ): Observable<PaginatedInventoryResponse<InventoryStock>> {
    return this.http.get<PaginatedInventoryResponse<InventoryStock>>(`${this.baseUrl}/articles/${articleId}/stock`, {
      params: toParams({ ...params }),
    });
  }

  // ---- Placements ----

  getPlacement(id: string): Observable<InventoryStock> {
    return this.http.get<InventoryStock>(`${this.baseUrl}/stock/${id}`);
  }

  createPlacement(articleId: string, compartmentId: string): Observable<InventoryStock> {
    return this.http.post<InventoryStock>(`${this.baseUrl}/stock`, { articleId, compartmentId });
  }

  deletePlacement(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/stock/${id}`);
  }

  // ---- Movements ----

  listMovements(
    params: InventoryListParams & InventoryMovementFilters = {},
  ): Observable<PaginatedInventoryResponse<InventoryMovement>> {
    return this.http.get<PaginatedInventoryResponse<InventoryMovement>>(`${this.baseUrl}/movements`, {
      params: toParams({ ...params }),
    });
  }

  putaway(dto: InventoryPutawayInput): Observable<InventoryMovement> {
    return this.http.post<InventoryMovement>(`${this.baseUrl}/movements/putaway`, dto);
  }

  transfer(dto: InventoryTransferInput): Observable<InventoryMovement> {
    return this.http.post<InventoryMovement>(`${this.baseUrl}/movements/transfer`, dto);
  }

  withdraw(dto: InventoryWithdrawalInput): Observable<InventoryMovement> {
    return this.http.post<InventoryMovement>(`${this.baseUrl}/movements/withdrawal`, dto);
  }

  /** Movement document, rendered by the spooler (the job and its file stay on the Spooler page). */
  downloadMovementPdf(id: string): Observable<Blob> {
    return this.spooler.spoolAndDownload(this.http.post<SpoolJob>(`${this.baseUrl}/movements/${id}/pdf/spool`, {}));
  }

  // ---- Withdrawal requests ----

  listRequests(
    params: InventoryListParams & { status?: InventoryWithdrawalRequestStatus; articleId?: string } = {},
  ): Observable<PaginatedInventoryResponse<InventoryWithdrawalRequest>> {
    return this.http.get<PaginatedInventoryResponse<InventoryWithdrawalRequest>>(
      `${this.baseUrl}/withdrawal-requests`,
      { params: toParams({ ...params }) },
    );
  }

  acceptRequest(
    id: string,
    allocations: InventoryRequestAllocation[],
    note?: string | null,
  ): Observable<InventoryWithdrawalRequest> {
    return this.http.post<InventoryWithdrawalRequest>(`${this.baseUrl}/withdrawal-requests/${id}/accept`, {
      allocations,
      note: note ?? null,
    });
  }

  rejectRequest(id: string, note?: string | null): Observable<InventoryWithdrawalRequest> {
    return this.http.post<InventoryWithdrawalRequest>(`${this.baseUrl}/withdrawal-requests/${id}/reject`, {
      note: note ?? null,
    });
  }

  // ---- Serial numbers ----

  listSerialUnits(
    params: InventoryListParams & InventorySerialUnitFilters = {},
  ): Observable<PaginatedInventoryResponse<InventorySerialUnit>> {
    return this.http.get<PaginatedInventoryResponse<InventorySerialUnit>>(`${this.baseUrl}/serial-units`, {
      params: toParams({ ...params }),
    });
  }

  // ---- Lendings ----

  listLendings(
    params: InventoryListParams & InventoryLendingFilters = {},
  ): Observable<PaginatedInventoryResponse<InventoryLending>> {
    return this.http.get<PaginatedInventoryResponse<InventoryLending>>(`${this.baseUrl}/lendings`, {
      params: toParams({ ...params }),
    });
  }

  getLending(id: string): Observable<InventoryLending> {
    return this.http.get<InventoryLending>(`${this.baseUrl}/lendings/${id}`);
  }

  lend(dto: InventoryLendingInput): Observable<InventoryLending> {
    return this.http.post<InventoryLending>(`${this.baseUrl}/lendings`, dto);
  }

  returnLending(id: string, dto: InventoryLendingReturnInput): Observable<InventoryLending> {
    return this.http.post<InventoryLending>(`${this.baseUrl}/lendings/${id}/return`, dto);
  }

  // ---- Labels ----

  getLabelOwner(): Observable<InventoryLabelOwner> {
    return this.http.get<InventoryLabelOwner>(`${this.baseUrl}/labels/owner`);
  }

  /** Selected labels as one PDF, rendered by the spooler (the job and its file stay on the Spooler page). */
  printLabels(request: InventoryLabelRequest): Observable<Blob> {
    return this.spooler.spoolAndDownload(this.http.post<SpoolJob>(`${this.baseUrl}/labels/spool`, request));
  }
}
