/**
 * DTO for a provider server type (e.g. Hetzner) with specs and pricing.
 * Used by GET /service-types/providers/:providerId/server-types for dropdowns and base price.
 */
export class ServerTypeDto {
  /** Unique identifier (e.g. cax11, cpx11). */
  id!: string;
  /** Human-readable name. */
  name!: string;
  /** CPU cores. */
  cores!: number;
  /** RAM in GB. */
  memory!: number;
  /** Disk in GB. */
  disk!: number;
  /** Price per month (e.g. EUR). */
  priceMonthly?: number;
  /** Price per hour (e.g. EUR). */
  priceHourly?: number;
  /** Optional description. */
  description?: string;
}
