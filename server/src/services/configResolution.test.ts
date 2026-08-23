import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

afterEach(() => {
  delete process.env.MONGO_URI;
  delete process.env.REDIS_URL;
});

test('explicit docker connection strings are preserved instead of being overwritten with localhost defaults', async () => {
  process.env.MONGO_URI = 'mongodb://mongo:27017/expense_manager?replicaSet=rs0';
  process.env.REDIS_URL = 'redis://redis:6379';

  const configPath = require.resolve('../config');
  delete require.cache[configPath];

  const config = require('../config').default;

  assert.equal(config.MONGO_URI, 'mongodb://mongo:27017/expense_manager?replicaSet=rs0');
  assert.equal(config.REDIS_URL, 'redis://redis:6379');
});

test('Render deployments start the export worker automatically unless disabled', () => {
  const previousRender = process.env.RENDER;
  const previousWorkerMode = process.env.WORKER_MODE;
  const previousEnableWorker = process.env.ENABLE_EXPORT_WORKER;

  process.env.RENDER = 'true';
  delete process.env.WORKER_MODE;
  delete process.env.ENABLE_EXPORT_WORKER;

  const configPath = require.resolve('../config');
  delete require.cache[configPath];

  try {
    const { shouldStartExportWorker } = require('../config');
    assert.equal(shouldStartExportWorker(), true);
  } finally {
    if (previousRender === undefined) delete process.env.RENDER; else process.env.RENDER = previousRender;
    if (previousWorkerMode === undefined) delete process.env.WORKER_MODE; else process.env.WORKER_MODE = previousWorkerMode;
    if (previousEnableWorker === undefined) delete process.env.ENABLE_EXPORT_WORKER; else process.env.ENABLE_EXPORT_WORKER = previousEnableWorker;
    delete require.cache[configPath];
  }
});

test('api-only mode disables the auto-started export worker', () => {
  const previousRender = process.env.RENDER;
  const previousWorkerMode = process.env.WORKER_MODE;
  const previousEnableWorker = process.env.ENABLE_EXPORT_WORKER;

  process.env.RENDER = 'true';
  process.env.WORKER_MODE = 'api';
  delete process.env.ENABLE_EXPORT_WORKER;

  const configPath = require.resolve('../config');
  delete require.cache[configPath];

  try {
    const { shouldStartExportWorker } = require('../config');
    assert.equal(shouldStartExportWorker(), false);
  } finally {
    if (previousRender === undefined) delete process.env.RENDER; else process.env.RENDER = previousRender;
    if (previousWorkerMode === undefined) delete process.env.WORKER_MODE; else process.env.WORKER_MODE = previousWorkerMode;
    if (previousEnableWorker === undefined) delete process.env.ENABLE_EXPORT_WORKER; else process.env.ENABLE_EXPORT_WORKER = previousEnableWorker;
    delete require.cache[configPath];
  }
});
