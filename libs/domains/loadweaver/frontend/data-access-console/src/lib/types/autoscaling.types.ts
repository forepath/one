/** The autoscaler's last evaluation of a service (3.23). */
export interface AutoscaleStatus {
  metric: string;
  target: number;
  min: number;
  max: number;
  /** The metric's value; null when it was missing (the autoscaler holds). */
  value: number | null;
  /** What it recommended within min..max (before stabilisation, cooldowns and limits). */
  desired: number;
  action: 'up' | 'down' | 'hold';
  reason: string;
  /** Why a wanted scale-up is limited (quota, cluster capacity, N+1 reserve, max); null when not blocked. */
  blocked: string | null;
  atMax: boolean;
  evaluatedAt: string;
}

/** An autoscaled service (`GET /autoscaling`). */
export interface AutoscaledService {
  /** `project/deployment/service` */
  id: string;
  project: string;
  deployment: string;
  service: string;
  min: number;
  max: number;
  metric: 'cpu' | 'memory' | 'requests' | 'custom';
  customMetric: string | null;
  target: number;
  /** Replicas placed now. */
  replicas: number;
  /** The count plans use (the autoscaler's last decision). */
  desiredReplicas: number;
  status: AutoscaleStatus | null;
  lastScaleAt: string | null;
  lastReason: string | null;
  lastValue: number | null;
}
