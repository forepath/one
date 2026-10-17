/** Join tokens are short-lived and single-use (3.21). */
export const JOIN_TOKEN_DEFAULT_TTL_MINUTES = 60;
export const JOIN_TOKEN_MAX_TTL_MINUTES = 24 * 60;
/** `lwj_` + 8 char lookup prefix + secret; only the hash is stored. */
export const JOIN_TOKEN_PREFIX = 'lwj_';
export const JOIN_TOKEN_LOOKUP_LENGTH = 12;

/** Node identity certificates are rotated automatically once less than a third of their lifetime is left. */
export const NODE_CERTIFICATE_VALIDITY_HOURS = 30 * 24;
export const CLUSTER_CA_VALIDITY_DAYS = 10 * 365;

/** Nodes without a heartbeat for this long count as unreachable (health tree, failover in M2). */
export const NODE_HEARTBEAT_TIMEOUT_MS = 30_000;

export const DEFAULT_GRPC_PORT = 7443;

/** Postgres advisory lock keys (3.13: locks via Postgres). */
export const ADVISORY_LOCK_CLUSTER_BOOTSTRAP = 0x4c570001;
export const ADVISORY_LOCK_NETWORK_COMPILE = 0x4c570002;
export const ADVISORY_LOCK_AUDIT_CHAIN = 0x4c570003;
export const ADVISORY_LOCK_ALLOCATION = 0x4c570004;
/**
 * Pod address allocation (plans, failover / drain, cron runs). Blocking, always taken last, so every allocator
 * sees the addresses the others committed.
 */
export const ADVISORY_LOCK_PLACEMENT_ALLOCATION = 0x4c57000a;
