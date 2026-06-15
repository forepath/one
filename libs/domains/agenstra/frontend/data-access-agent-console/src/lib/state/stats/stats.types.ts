/**
 * Docker container statistics structure
 * Based on Docker API ContainerStats response
 */
export interface ContainerStats {
  read: string; // Timestamp when stats were read
  preread: string; // Previous read timestamp
  pids_stats?: {
    current?: number;
  };
  blkio_stats?: Record<string, unknown>;
  num_procs?: number;
  storage_stats?: Record<string, unknown>;
  cpu_stats?: {
    cpu_usage?: {
      total_usage?: number;
      percpu_usage?: number[];
      usage_in_kernelmode?: number;
      usage_in_usermode?: number;
    };
    system_cpu_usage?: number;
    online_cpus?: number;
    throttled_data?: Record<string, unknown>;
  };
  precpu_stats?: {
    cpu_usage?: {
      total_usage?: number;
      percpu_usage?: number[];
      usage_in_kernelmode?: number;
      usage_in_usermode?: number;
    };
    system_cpu_usage?: number;
    online_cpus?: number;
    throttled_data?: Record<string, unknown>;
  };
  memory_stats?: {
    usage?: number;
    max_usage?: number;
    limit?: number;
    stats?: Record<string, unknown>;
  };
  networks?: Record<string, unknown>;
}

/**
 * Container run status (from backend broadcast).
 */
export interface ContainerRunStatus {
  running: boolean;
}

/**
 * Container stats entry with timestamp
 * Includes clientId and agentId to ensure unique identification and prevent collisions.
 * When container is stopped, stats may be undefined but status is set.
 */
export interface ContainerStatsEntry {
  stats: ContainerStats; // Present when container is running
  status: ContainerRunStatus; // Present when payload includes status (running/stopped)
  timestamp: string; // ISO timestamp when stats were collected
  receivedAt: number; // Timestamp when stats were received by the client (Date.now())
  clientId: string; // Client ID that these stats belong to
  agentId: string; // Agent ID that these stats belong to
}

// Note: ContainerStatsPayload is defined in sockets.types.ts since it's part of the socket payload types
