// The fleet integration (P gate) starts its own containers in the suite; this only fixes the process defaults
// before any module reads its environment.
Object.assign(process.env, {
  NODE_ENV: 'test',
  AUTHENTICATION_METHOD: 'api-key',
  STATIC_API_KEY: 'fleet-integration-api-key',
  ENCRYPTION_KEY: 'MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=',
  RATE_LIMIT_ENABLED: 'false',
  QUEUE_BULL_BOARD_ENABLED: 'false',
  // The control planes of the lab listen on localhost over plain http.
  FLEET_CLUSTER_ENDPOINT_ALLOW_INTERNAL_HOST: 'true',
  FLEET_CLUSTER_ENDPOINT_ALLOW_INSECURE_HTTP: 'true',
  FLEET_CACHE_TTL_MS: '0',
});
