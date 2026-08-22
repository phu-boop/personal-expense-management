export type HealthStatus = {
  status: 'ok' | 'degraded';
  database: 'connected' | 'disconnected';
  redis: 'connected' | 'disconnected';
  uptimeSeconds: number;
  timestamp: string;
};

export type HealthCheckInput = {
  dbConnected: boolean;
  redisConnected: boolean;
  uptimeMs: number;
  timestamp: string;
};

export function buildHealthStatus(input: HealthCheckInput): HealthStatus {
  const database = input.dbConnected ? 'connected' : 'disconnected';
  const redis = input.redisConnected ? 'connected' : 'disconnected';

  return {
    status: input.dbConnected && input.redisConnected ? 'ok' : 'degraded',
    database,
    redis,
    uptimeSeconds: Math.max(0, Math.floor(input.uptimeMs / 1000)),
    timestamp: input.timestamp,
  };
}

export function isReadyForTraffic(status: Pick<HealthStatus, 'status' | 'database' | 'redis'>): boolean {
  return status.status === 'ok' && status.database === 'connected' && status.redis === 'connected';
}
