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
