import { enqueueSnapshotJob } from './redisQueue';

export const enqueueSnapshotCheck = async (walletId: string) => {
  try {
    await enqueueSnapshotJob({ walletId });
  } catch (err) {
    // best-effort: swallow so we don't impact request flow
    console.warn('enqueueSnapshotCheck failed', err);
  }
};
