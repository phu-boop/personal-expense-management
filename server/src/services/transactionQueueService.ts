import { createRedisQueueFromEnvironment } from './redisQueue';

export const enqueueSnapshotCheck = async (walletId: string) => {
  try {
    const queue = await createRedisQueueFromEnvironment();
    await queue.enqueue('snapshot-check', { walletId });
  } catch (err) {
    // best-effort: swallow so we don't impact request flow
    console.warn('enqueueSnapshotCheck failed', err);
  }
};
