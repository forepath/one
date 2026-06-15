import { ClientResponseDto } from './client-response.dto';

/**
 * DTO for client creation response.
 * Includes the API key (provided or generated) for API_KEY authentication type.
 * This is only returned once during creation and should be securely stored by the caller.
 */
export class CreateClientResponseDto extends ClientResponseDto {
  /**
   * The API key for the client (only for API_KEY authentication type).
   * Can be provided during creation or auto-generated if not provided.
   * This is only returned once during creation and should be securely stored by the caller.
   */
  apiKey?: string;
}
