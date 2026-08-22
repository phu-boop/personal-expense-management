export type WorkerMetricsSnapshot = {
  queued: number;
  processed: number;
  failed: number;
  retries: number;
  deadLetters: number;
  totalProcessingMs: number;
  averageProcessingMs: number;
};

export function createWorkerMetrics() {
  let queued = 0;
  let processed = 0;
  let failed = 0;
  let retries = 0;
  let deadLetters = 0;
  let totalProcessingMs = 0;
  let processedSamples = 0;

  return {
    recordJobQueued() {
      queued += 1;
    },
    recordJobProcessed(durationMs: number) {
      processed += 1;
      processedSamples += 1;
      totalProcessingMs += durationMs;
    },
    recordJobFailed() {
      failed += 1;
    },
    recordRetry() {
      retries += 1;
    },
    recordDeadLetter() {
      deadLetters += 1;
    },
    snapshot(): WorkerMetricsSnapshot {
      return {
        queued,
        processed,
        failed,
        retries,
        deadLetters,
        totalProcessingMs,
        averageProcessingMs: processedSamples > 0 ? totalProcessingMs / processedSamples : 0,
      };
    },
  };
}
