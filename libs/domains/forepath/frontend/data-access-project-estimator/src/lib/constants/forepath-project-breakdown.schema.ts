import { FOREPATH_SERVICE_IDS } from './forepath-service-catalog.constants';

/**
 * JSON Schema string for WebLLM grammar-constrained generation.
 * WebLLM requires `response_format.schema` to be a string when `type` is `json_object`.
 */
export const FOREPATH_PROJECT_BREAKDOWN_JSON_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    summary: { type: 'string' },
    lineItems: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          serviceId: { type: 'string', enum: [...FOREPATH_SERVICE_IDS] },
          description: { type: 'string' },
          billingUnits: { type: 'number' },
          quantity: { type: 'number' },
          rateTier: { type: 'string', enum: ['standard', 'emergency-week', 'emergency-sunday'] },
        },
        required: ['serviceId', 'description'],
      },
    },
    assumptions: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
  },
  required: ['summary', 'lineItems', 'assumptions', 'confidence'],
});
