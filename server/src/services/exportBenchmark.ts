export type BenchmarkOptions<T> = {
  concurrency?: number;
  onProgress?: (index: number, total: number, startedAt: number) => void;
  worker: (item: T, index: number) => Promise<void>;
};

export type BenchmarkSummary = {
  totalItems: number;
  totalDurationMs: number;
  averageMs: number;
  minMs: number;
  maxMs: number;
  p95Ms: number;
  opsPerSecond: number;
  successCount: number;
  failureCount: number;
};

export type BenchmarkResult<T> = {
  items: T[];
  durationsMs: number[];
  summary: BenchmarkSummary;
};

export async function runBenchmark<T>(items: T[], options: BenchmarkOptions<T>): Promise<BenchmarkResult<T>> {
  const concurrency = Math.max(1, options.concurrency ?? 1);
  const durationsMs: number[] = [];
  const startedAt = Date.now();
  let index = 0;
  let successCount = 0;
  let failureCount = 0;

  const workerQueue = async () => {
    while (index < items.length) {
      const currentIndex = index++;
      const item = items[currentIndex];
      const itemStartedAt = Date.now();

      if (options.onProgress) {
        options.onProgress(currentIndex, items.length, itemStartedAt);
      }

      try {
        await options.worker(item, currentIndex);
        successCount += 1;
      } catch {
        failureCount += 1;
      }

      durationsMs.push(Date.now() - itemStartedAt);
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => workerQueue());
  await Promise.all(workers);

  const totalDurationMs = Date.now() - startedAt;
  const sortedDurations = [...durationsMs].sort((a, b) => a - b);
  const averageMs = sortedDurations.length > 0 ? sortedDurations.reduce((sum, value) => sum + value, 0) / sortedDurations.length : 0;
  const minMs = sortedDurations.length > 0 ? sortedDurations[0] : 0;
  const maxMs = sortedDurations.length > 0 ? sortedDurations[sortedDurations.length - 1] : 0;
  const p95Index = Math.max(0, Math.ceil(sortedDurations.length * 0.95) - 1);
  const p95Ms = sortedDurations.length > 0 ? sortedDurations[p95Index] : 0;

  return {
    items,
    durationsMs,
    summary: {
      totalItems: items.length,
      totalDurationMs,
      averageMs,
      minMs,
      maxMs,
      p95Ms,
      opsPerSecond: totalDurationMs > 0 ? (items.length / totalDurationMs) * 1000 : 0,
      successCount,
      failureCount,
    },
  };
}

export function formatBenchmarkSummary(summary: BenchmarkSummary): string {
  return [
    `items: ${summary.totalItems}`,
    `success: ${summary.successCount}`,
    `failure: ${summary.failureCount}`,
    `avg: ${summary.averageMs.toFixed(2)} ms`,
    `p95: ${summary.p95Ms.toFixed(2)} ms`,
    `min: ${summary.minMs.toFixed(2)} ms`,
    `max: ${summary.maxMs.toFixed(2)} ms`,
    `throughput: ${summary.opsPerSecond.toFixed(2)} ops/sec`,
    `total: ${summary.totalDurationMs.toFixed(2)} ms`,
  ].join(' | ');
}
