import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildHealthStatus, isReadyForTraffic } from './healthCheck';

test('buildHealthStatus marks the app healthy when database and redis are connected', () => {
  const status = buildHealthStatus({
    dbConnected: true,
    redisConnected: true,
    uptimeMs: 15000,
    timestamp: '2026-08-21T00:00:00.000Z',
  });

  assert.equal(status.status, 'ok');
  assert.equal(status.database, 'connected');
  assert.equal(status.redis, 'connected');
  assert.equal(status.uptimeSeconds, 15);
});

test('buildHealthStatus marks the app degraded when database or redis is unavailable', () => {
  const status = buildHealthStatus({
    dbConnected: false,
    redisConnected: true,
    uptimeMs: 1000,
    timestamp: '2026-08-21T00:00:00.000Z',
  });

  assert.equal(status.status, 'degraded');
  assert.equal(status.database, 'disconnected');
  assert.equal(status.redis, 'connected');
});

test('isReadyForTraffic only returns true when all required dependencies are connected', () => {
  assert.equal(isReadyForTraffic({ status: 'ok', database: 'connected', redis: 'connected' }), true);
  assert.equal(isReadyForTraffic({ status: 'degraded', database: 'connected', redis: 'disconnected' }), false);
  assert.equal(isReadyForTraffic({ status: 'degraded', database: 'disconnected', redis: 'connected' }), false);
});
