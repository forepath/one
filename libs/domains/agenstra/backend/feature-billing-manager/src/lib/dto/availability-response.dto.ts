export class AvailabilityResponseDto {
  isAvailable!: boolean;
  reason?: string;
  alternatives?: Record<string, unknown>;
}
